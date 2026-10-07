import { constants as fsConstants } from 'node:fs'
import { copyFile, lstat, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import type { AgentChangesState } from '@shared/types'
import { createBaselineGit, createRepoGit } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'
import { parseNulSeparatedPaths } from './gitPathParsing'
import { isGitTimeoutError } from './gitStepErrors'

// エージェントの実行の前の作業ツリーを、利用者の index・stash・HEAD を変えずに記録する(設計書「記録の中身」)。
// .git/index をアプリの一時ディレクトリ(0700)へ写し、GIT_INDEX_FILE をその写しにして `git add -A` する(確認の結果 2)。
// 記録のインデックスは消さずに残し、一覧・diff・戻すが GIT_INDEX_FILE で使う(確認の結果 5)。.git の中には置かない

/** 記録の時点の未追跡(ignore されていない)のファイルの数の上限。超えると記録しない */
export const AGENT_BASELINE_MAX_UNTRACKED_FILES = 5_000
/** 記録の時点の未追跡のファイル(除外の後)の合計の大きさの上限(バイト)。超えると記録しない */
export const AGENT_BASELINE_MAX_UNTRACKED_BYTES = 100 * 1024 * 1024
/** これを超える大きさの未追跡のファイルは記録から除外する(バイト。diff の未追跡の上限と同じ値) */
export const AGENT_BASELINE_EXCLUDE_FILE_BYTES = 5 * 1024 * 1024

/** 記録の時点に大きすぎて除外した未追跡のファイル。一覧で変わったかを見るため、大きさと更新時刻を控える */
export interface ExcludedBaselineFile {
  path: string
  size: number
  mtimeMs: number
}

/** 1 つの記録。renderer には渡さない(場所を IPC に出さない。パターン 144) */
export interface BaselineSnapshot {
  /** 記録を取ったときの許可のフォルダ(リポジトリの最上位) */
  folderPath: string
  /** 記録のインデックスを置いた一時ディレクトリ。記録を捨てるときに消す */
  tempDir: string
  indexPath: string
  startedAt: number
  /** 記録の時点の HEAD(コミットが無ければ null) */
  head: string | null
  excluded: ExcludedBaselineFile[]
  /** 記録の時点からあった、コミットの無い入れ子のリポジトリ(末尾 '/')。記録に入れていないため、一覧では notRecorded の行にする */
  skippedRepos: string[]
}

export type AgentChangesUnavailable = Extract<AgentChangesState, { kind: 'unavailable' }>

export type BaselineSnapshotResult =
  | { kind: 'recorded'; snapshot: BaselineSnapshot }
  | { kind: 'unavailable'; state: AgentChangesUnavailable }
  /** 待つ間に記録が取り消された(フォルダの切り替え・記録の破棄・アプリの終了)。一時ディレクトリは消してある */
  | { kind: 'canceled' }

export interface TakeBaselineOptions extends BaselineGitOptions {
  /** await のたびに呼び、true なら一時ディレクトリを消して canceled を返す(パターン 141) */
  isCanceled?: () => boolean
  now?: () => number
  /** 一時ディレクトリの親(既定は OS の一時ディレクトリ)。テストで差し替える */
  tempRoot?: string
}

const TEMP_DIR_PREFIX = 'prompt-ide-agent-baseline-'

class SnapshotCanceled extends Error {}

/** 記録の一時ディレクトリを消す(失敗は握る。残ったものは OS の一時ディレクトリの掃除に任せる) */
export async function removeBaselineDir(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
}

/** アプリの終了(before-quit)で、待たずに消す */
export function removeBaselineDirSync(tempDir: string): void {
  try {
    rmSync(tempDir, { recursive: true, force: true })
  } catch {
    // 消せなかったものは OS の一時ディレクトリの掃除に任せる
  }
}

// git rev-parse --show-toplevel・mkdtemp などのパスの表記を揃える(macOS の /var → /private/var など)
// パスの末尾・先頭の空白は意味を持つため trim せず、git が付ける末尾の改行だけを除く
const stripTrailingNewline = (output: string): string => output.replace(/\r?\n$/, '')

const canonical = async (path: string): Promise<string> => realpath(path).catch(() => path)

/** 記録の前の検査: 未追跡(ignore されていない)のファイルの数・大きさ。大きいファイルは除外の対象として返す */
async function inspectUntracked(
  folderPath: string,
  output: string,
  gitOptions: BaselineGitOptions
): Promise<
  | { kind: 'ok'; excluded: ExcludedBaselineFile[]; skippedRepos: string[] }
  | { kind: 'too-many'; count: number; bytes: number }
> {
  const paths = parseNulSeparatedPaths(output)
  if (paths.length > AGENT_BASELINE_MAX_UNTRACKED_FILES) {
    return { kind: 'too-many', count: paths.length, bytes: 0 }
  }
  const excluded: ExcludedBaselineFile[] = []
  const skippedRepos: string[] = []
  let bytes = 0
  for (const path of paths) {
    // 入れ子のリポジトリ('sub/')は gitlink として記録され、中身は数えない。ただしコミットの無いもの(git init しただけ)は
    // `git add -A` が exit 128 で失敗するため、記録から外す
    if (path.endsWith('/')) {
      const nestedHead = await createRepoGit(join(folderPath, path), gitOptions).raw([
        'rev-parse',
        '--verify',
        '-q',
        'HEAD'
      ])
      if (nestedHead.trim() === '') skippedRepos.push(path)
      continue
    }
    const stat = await lstat(join(folderPath, path)).catch(() => null)
    if (stat === null || !stat.isFile()) continue
    if (stat.size > AGENT_BASELINE_EXCLUDE_FILE_BYTES) {
      excluded.push({ path, size: stat.size, mtimeMs: stat.mtimeMs })
    } else {
      bytes += stat.size
    }
  }
  if (bytes > AGENT_BASELINE_MAX_UNTRACKED_BYTES) {
    return { kind: 'too-many', count: paths.length, bytes }
  }
  return { kind: 'ok', excluded, skippedRepos }
}

/**
 * 記録を取る。手順: リポジトリの最上位か → 未追跡の事前の検査 → 一時ディレクトリ → .git/index の写し(無ければ空)→
 * `git add -A`(除外したファイルを pathspec で外す)→ HEAD を控える。各 git に打ち切り(既定 10 秒)
 */
export async function takeBaselineSnapshot(
  folderPath: string,
  {
    isCanceled = () => false,
    now = Date.now,
    tempRoot = tmpdir(),
    ...gitOptions
  }: TakeBaselineOptions = {}
): Promise<BaselineSnapshotResult> {
  const startedAt = now()
  const repoGit = createRepoGit(folderPath, gitOptions)
  let tempDir: string | null = null
  const checkpoint = (): void => {
    if (isCanceled()) throw new SnapshotCanceled()
  }
  try {
    const isRepo = await repoGit.checkIsRepo()
    checkpoint()
    if (!isRepo)
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-repository' } }
    const toplevel = stripTrailingNewline(await repoGit.raw(['rev-parse', '--show-toplevel']))
    checkpoint()
    if ((await canonical(toplevel)) !== (await canonical(folderPath))) {
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'not-toplevel' } }
    }
    const inspection = await inspectUntracked(
      folderPath,
      await repoGit.raw(['ls-files', '-z', '--others', '--exclude-standard']),
      gitOptions
    )
    checkpoint()
    if (inspection.kind === 'too-many') {
      return {
        kind: 'unavailable',
        state: {
          kind: 'unavailable',
          reason: 'too-many-untracked',
          untrackedCount: inspection.count,
          untrackedBytes: inspection.bytes
        }
      }
    }
    tempDir = await mkdtemp(join(tempRoot, TEMP_DIR_PREFIX))
    const indexPath = join(tempDir, 'index')
    // worktree の .git はファイルのため、index の場所は git に聞く(相対ならリポジトリの最上位から)
    const userIndex = stripTrailingNewline(await repoGit.raw(['rev-parse', '--git-path', 'index']))
    checkpoint()
    // 写しから始めると stat の情報が使え、変わっていないファイルを読み直さない。コミットの無いリポジトリは index が無く、
    // 空から始める(確認の結果 15)
    await copyFile(
      isAbsolute(userIndex) ? userIndex : join(folderPath, userIndex),
      indexPath,
      fsConstants.COPYFILE_EXCL
    ).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') throw error
    })
    checkpoint()
    // 除外の pathspec は数が多くても引数の長さの上限に触れないよう、一時ディレクトリのファイルで渡す
    const pathspecFile = join(tempDir, 'pathspec')
    const pathspecs = [
      '.',
      ...[
        ...inspection.excluded.map((file) => file.path),
        ...inspection.skippedRepos.map((path) => path.slice(0, -1))
      ].map((path) => `:(exclude,literal)${path}`)
    ]
    await writeFile(pathspecFile, pathspecs.map((spec) => `${spec}\0`).join(''), { flag: 'wx' })
    checkpoint()
    const baselineGit = createBaselineGit(folderPath, indexPath, {
      ...gitOptions,
      // core.splitIndex=false は createBaselineGit が常に付ける
      config: ['advice.addEmbeddedRepo=false']
    })
    await baselineGit.raw([
      'add',
      '-A',
      `--pathspec-from-file=${pathspecFile}`,
      '--pathspec-file-nul'
    ])
    checkpoint()
    // コミットが無いときは -q で出力が空になる(失敗にならない)。打ち切りなどの失敗は握らず、呼び出し側で扱う
    const head = (await repoGit.raw(['rev-parse', '--verify', '-q', 'HEAD'])).trim() || null
    checkpoint()
    return {
      kind: 'recorded',
      snapshot: {
        folderPath,
        tempDir,
        indexPath,
        startedAt,
        head,
        excluded: inspection.excluded,
        skippedRepos: inspection.skippedRepos
      }
    }
  } catch (error) {
    if (tempDir !== null) await removeBaselineDir(tempDir)
    if (error instanceof SnapshotCanceled) return { kind: 'canceled' }
    if (isGitTimeoutError(error)) {
      return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'timeout' } }
    }
    return { kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } }
  }
}
