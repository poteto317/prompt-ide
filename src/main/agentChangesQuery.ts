import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import type { SimpleGit } from 'simple-git'
import type { AgentChangeEntry, AgentChangeStatus, AgentChangesList } from '@shared/types'
import { AGENT_CHANGES_LIST_LIMIT, toAgentChangeRelativePath } from '@shared/types'
import {
  assertBaselineIndex,
  containsNotRecorded,
  hasIgnoredInside,
  isIgnoredAtBaseline,
  isNotRecordedPath,
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

// 一覧の並び(パスの順。git の表記のままバイト順に近い比較)
const byPath = (a: AgentChangeEntry, b: AgentChangeEntry): number =>
  a.path < b.path ? -1 : a.path > b.path ? 1 : 0

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
  return entries.sort(byPath)
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

// 途中の実行の、記録から除外した(5MB を超える)ファイルの変化。両端の控え(有無・大きさ・更新時刻)で分かるものだけを出す。
// 片方の端にだけ控えがあるときは、もう片方の端で別の理由(ignore 済み・入れ子のリポジトリ)で記録していなければ、出現・削除とする
function excludedChangesBetween(
  start: BaselineSnapshot,
  end: BaselineSnapshot
): AgentChangeEntry[] {
  const before = new Map(start.excluded.map((file) => [file.path, file]))
  const after = new Map(end.excluded.map((file) => [file.path, file]))
  const result: AgentChangeEntry[] = []
  for (const path of new Set([...before.keys(), ...after.keys()])) {
    const b = before.get(path)
    const a = after.get(path)
    let status: AgentChangeStatus | null
    if (b !== undefined && a !== undefined) {
      status = b.size !== a.size || b.mtimeMs !== a.mtimeMs ? 'M' : null
    } else if (a !== undefined) {
      status = isNotRecordedPath(start, path) ? null : 'A'
    } else {
      status = isNotRecordedPath(end, path) ? null : 'D'
    }
    if (status !== null) result.push({ path, status, isDirectory: false, notRecorded: true })
  }
  return result
}

// 途中の実行の、コミットの無い入れ子のリポジトリ('<dir>/')の出現・削除。中身を記録していないため有無だけで見る
// (両端にあるときは出さない。中身が変わっても分からない。既知の制約)
function skippedRepoChangesBetween(
  start: BaselineSnapshot,
  end: BaselineSnapshot
): AgentChangeEntry[] {
  const result: AgentChangeEntry[] = []
  for (const repo of new Set([...start.skippedRepos, ...end.skippedRepos])) {
    const inStart = start.skippedRepos.includes(repo)
    const inEnd = end.skippedRepos.includes(repo)
    if (inStart === inEnd) continue
    // もう片方の端で ignore 済みなどで記録していなければ、有無が分からないため出さない
    if (isNotRecordedPath(inEnd ? start : end, toAgentChangeRelativePath(repo))) continue
    result.push({ path: repo, status: inEnd ? 'A' : 'D', isDirectory: true, notRecorded: true })
  }
  return result
}

/**
 * 途中の実行(開始の区切り start → 次の区切り end)の変更のすべて(打ち切らない)。パスの順。
 * `git diff-tree` で tree どうしを比べ、利用者の index と作業ツリーを読まない(設計書「範囲ごとの一覧と diff」)。
 * 新しいフォルダを 1 行にまとめない。どちらかの端で記録しなかったパスは、tree の差分の行から外して notRecorded の行にする。
 * ignore 済みのファイルの出現・削除は、累積の一覧と同じく出さない。使うのは listAgentChangesBetween だけ
 * (戻す操作は累積の範囲だけで、collectAgentChangeEntries と違い agentChangesRevert からは使わない)
 */
async function collectAgentChangeEntriesBetween(
  start: BaselineSnapshot,
  end: BaselineSnapshot,
  options: BaselineGitOptions = {}
): Promise<AgentChangeEntry[]> {
  // 記録の git と同じ環境(利用者の別のリポジトリ・object の置き場を指す変数を除く)で問い合わせる。diff-tree は index を読まない
  const git = createBaselineGit(start.folderPath, start.indexPath, options)
  const tracked = parseNameStatus(
    await git
      .raw(['diff-tree', '-r', '-z', '--name-status', '--no-renames', start.tree, end.tree])
      .catch((error: unknown) => {
        throw toBaselineQueryError(error)
      })
  )
  const entries: AgentChangeEntry[] = []
  const listed = new Set<string>()
  const add = (entry: AgentChangeEntry): void => {
    entries.push(entry)
    listed.add(toAgentChangeRelativePath(entry.path))
  }
  for (const { path, status } of tracked) {
    // どちらかの端で記録しなかったパスは、片方は tree・もう片方は記録の外にある(両端に何かがある)。中身を比べられないため
    // M の notRecorded の 1 行にする
    if (isNotRecordedPath(start, path) || isNotRecordedPath(end, path)) {
      add({ path, status: 'M', isDirectory: false, notRecorded: true })
    } else {
      add({ path, status, isDirectory: false, notRecorded: false })
    }
  }
  for (const entry of [
    ...excludedChangesBetween(start, end),
    ...skippedRepoChangesBetween(start, end)
  ]) {
    if (!listed.has(toAgentChangeRelativePath(entry.path))) add(entry)
  }
  return entries.sort(byPath)
}

/** 途中の実行の変更の一覧。AGENT_CHANGES_LIST_LIMIT 件で打ち切り、範囲の両端で HEAD が変わったかを添える */
export async function listAgentChangesBetween(
  start: BaselineSnapshot,
  end: BaselineSnapshot,
  options: BaselineGitOptions = {}
): Promise<AgentChangesList> {
  const entries = await collectAgentChangeEntriesBetween(start, end, options)
  return {
    entries: entries.slice(0, AGENT_CHANGES_LIST_LIMIT),
    totalCount: entries.length,
    truncated: entries.length > AGENT_CHANGES_LIST_LIMIT,
    headChanged: start.head !== end.head
  }
}
