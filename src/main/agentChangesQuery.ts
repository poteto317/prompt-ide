import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SimpleGit } from 'simple-git'
import type { AgentChangeEntry, AgentChangeStatus, AgentChangesList } from '@shared/types'
import { AGENT_CHANGES_LIST_LIMIT } from '@shared/types'
import {
  assertBaselineIndex,
  containsNotRecorded,
  hasIgnoredInside,
  isIgnoredAtBaseline,
  toBaselineQueryError
} from './agentBaselineCoverage'
import { createBaselineGit, createRepoGit } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import { parseNulSeparatedPaths, toLiteralPathspec } from './gitPathParsing'

// エージェントの変更の一覧(設計書「確認の結果」5)。記録のインデックス(GIT_INDEX_FILE)と作業ツリーを比べる:
// - `git diff --name-status --no-renames -z`: 記録の時点にあったファイルの変更・削除・種類の変更
// - `git ls-files -z --others --exclude-standard --directory --no-empty-directory`: 記録の後に現れたファイル。
//   新しいフォルダは 1 行('<dir>/')にまとめる
// どちらも blob を書かず、利用者の .git/index を変えない。リネームは削除 + 追加の 2 行になる

// name-status の 1 文字。記録のインデックスはコンフリクトのエントリを持たない(add -A が解消する)。
// 未知の文字は内容が変わったものとして M にする
const toStatus = (letter: string): AgentChangeStatus =>
  letter === 'D' || letter === 'T' || letter === 'A' ? letter : 'M'

function parseNameStatus(output: string): { path: string; status: AgentChangeStatus }[] {
  const tokens = output.split('\0')
  const result: { path: string; status: AgentChangeStatus }[] = []
  for (let i = 0; i + 1 < tokens.length; i += 2) {
    if (tokens[i] === '') break
    result.push({ status: toStatus(tokens[i].charAt(0)), path: tokens[i + 1] })
  }
  return result
}

// 記録の時点に ignore されていたフォルダ('a/b/')のうち、path の祖先で最も浅いもの。無ければ null
function ignoredAncestorDir(snapshot: BaselineSnapshot, path: string): string | null {
  for (let slash = path.indexOf('/'); slash !== -1; slash = path.indexOf('/', slash + 1)) {
    const dir = path.slice(0, slash + 1)
    if (isIgnoredAtBaseline(snapshot, dir)) return dir
  }
  return null
}

// まとめたフォルダの行のうち、記録の前からあったと分かる中身(ignore されたファイル・記録から除外したファイル・
// 記録から外した入れ子のリポジトリ・記録の時点に ignore されていたもの)を持つものは、まとめずに中のファイルを 1 行ずつにする。
// まとめたままだと、戻すとそれらをフォルダごとゴミ箱へ移し(I1)、何もしなくても行が出続けてすべて戻すを常に拒否する(M1)。
// 展開には --directory を付けないので、入れ子のリポジトリだけが '<sub>/' の 1 行で残る(git は入れ子のリポジトリの中へ降りない)。
// フォルダ自体が記録の時点に ignore されていたもの(node_modules/ など)は展開せず 1 行のまま notRecorded にする。展開した中の、
// 記録の時点に ignore されていたフォルダの中のファイルも、そのフォルダの 1 行にまとめ直す(展開で数万行になって打ち切りに当たらない)
async function expandPreexistingFolders(
  git: SimpleGit,
  snapshot: BaselineSnapshot,
  others: string[]
): Promise<string[]> {
  const result: string[] = []
  for (const path of others) {
    if (
      !path.endsWith('/') ||
      snapshot.skippedRepos.includes(path) ||
      isIgnoredAtBaseline(snapshot, path)
    ) {
      result.push(path)
      continue
    }
    const preexisting = containsNotRecorded(snapshot, path) || (await hasIgnoredInside(git, path))
    if (!preexisting) {
      result.push(path)
      continue
    }
    const collapsed = new Set<string>()
    for (const inner of parseNulSeparatedPaths(
      await git.raw([
        'ls-files',
        '-z',
        '--others',
        '--exclude-standard',
        '--',
        toLiteralPathspec(path)
      ])
    )) {
      const ignoredDir = ignoredAncestorDir(snapshot, inner)
      if (ignoredDir === null) result.push(inner)
      else if (!collapsed.has(ignoredDir)) {
        collapsed.add(ignoredDir)
        result.push(ignoredDir)
      }
    }
  }
  return result
}

// 記録しなかった(大きすぎて除外した)ファイルの、いまの状態。変わっていなければ一覧に出さない
async function excludedChange(
  folderPath: string,
  file: BaselineSnapshot['excluded'][number]
): Promise<'unchanged' | 'modified' | 'deleted'> {
  const stat = await lstat(join(folderPath, file.path)).catch(() => null)
  if (stat === null) return 'deleted'
  return stat.isFile() && stat.size === file.size && stat.mtimeMs === file.mtimeMs
    ? 'unchanged'
    : 'modified'
}

const inodeKey = ({ dev, ino }: { dev: number; ino: number }): string => `${dev}:${ino}`

// 記録から除外したファイルがエージェントに別の名前へ移された(同じファイルシステムの rename は inode を保つ)なら、移した先の
// 「追加」の行は記録の前からあった唯一の実体なので、戻せない行にする(A-1)。除外のファイルが消えたときだけ追加の行を調べる。
// 新しいフォルダの中へ移された場合(フォルダの 1 行)・コピー・別のファイルシステムへの移動は拾えない(既知の制約)
async function markMovedExcluded(
  folderPath: string,
  entries: AgentChangeEntry[],
  movedAway: Set<string>
): Promise<void> {
  for (const entry of entries) {
    if (entry.status !== 'A' || entry.isDirectory || entry.notRecorded) continue
    const stat = await lstat(join(folderPath, entry.path)).catch(() => null)
    if (stat !== null && stat.isFile() && movedAway.has(inodeKey(stat))) entry.notRecorded = true
  }
}

/** 記録の時点 → いまの作業ツリーの変更のすべて(打ち切らない)。パスの順。戻す操作の照合(agentChangesRevert)も使う */
export async function collectAgentChangeEntries(
  snapshot: BaselineSnapshot,
  options: BaselineGitOptions = {}
): Promise<AgentChangeEntry[]> {
  const { folderPath, indexPath } = snapshot
  await assertBaselineIndex(indexPath)
  const git = createBaselineGit(folderPath, indexPath, options)
  const tracked = parseNameStatus(
    await git.raw(['diff', '--name-status', '--no-renames', '-z']).catch((error: unknown) => {
      throw toBaselineQueryError(error)
    })
  )
  const others = await expandPreexistingFolders(
    git,
    snapshot,
    parseNulSeparatedPaths(
      await git.raw([
        'ls-files',
        '-z',
        '--others',
        '--exclude-standard',
        '--directory',
        '--no-empty-directory'
      ])
    )
  )
  const excludedByPath = new Map(snapshot.excluded.map((file) => [file.path, file]))
  const entries: AgentChangeEntry[] = tracked.map(({ path, status }) => ({
    path,
    status,
    isDirectory: false,
    notRecorded: false
  }))
  for (const path of others) {
    const isDirectory = path.endsWith('/')
    if (isDirectory) {
      // 除外したファイルを中に含む新しいフォルダ・記録の時点に ignore されていたフォルダ(前方一致なのでフォルダ自身も当たる)は、
      // ゴミ箱へ移すと記録していない内容を失うため戻せない
      const notRecorded = containsNotRecorded(snapshot, path)
      entries.push({ path, status: 'A', isDirectory, notRecorded })
      continue
    }
    const excluded = excludedByPath.get(path)
    if (excluded === undefined) {
      // 記録の時点に ignore されていたファイル(記録の後に ignore の規則から外れた)は、記録の前からあったもの(A-1)
      entries.push({
        path,
        status: 'A',
        isDirectory,
        notRecorded: isIgnoredAtBaseline(snapshot, path)
      })
      continue
    }
    excludedByPath.delete(path)
    if ((await excludedChange(folderPath, excluded)) === 'modified') {
      entries.push({ path, status: 'M', isDirectory, notRecorded: true })
    }
  }
  // 一覧に現れなかった除外のファイルは、消えたものだけを出す(ignore されたもの・追跡に変わったものは出さない)
  const movedAway = new Set<string>()
  for (const excluded of excludedByPath.values()) {
    if ((await excludedChange(folderPath, excluded)) === 'deleted') {
      entries.push({ path: excluded.path, status: 'D', isDirectory: false, notRecorded: true })
      movedAway.add(inodeKey(excluded))
    }
  }
  if (movedAway.size > 0) await markMovedExcluded(folderPath, entries, movedAway)
  return entries.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
}

/** 記録の時点 → いまの作業ツリーの変更の一覧。AGENT_CHANGES_LIST_LIMIT 件で打ち切り、HEAD が変わったかを添える */
export async function listAgentChanges(
  snapshot: BaselineSnapshot,
  options: BaselineGitOptions = {}
): Promise<AgentChangesList> {
  const entries = await collectAgentChangeEntries(snapshot, options)
  const head = await createRepoGit(snapshot.folderPath, options)
    .raw(['rev-parse', '--verify', '-q', 'HEAD'])
    .then((output) => output.trim() || null)
  return {
    entries: entries.slice(0, AGENT_CHANGES_LIST_LIMIT),
    totalCount: entries.length,
    truncated: entries.length > AGENT_CHANGES_LIST_LIMIT,
    headChanged: head !== snapshot.head
  }
}
