import { lstat } from 'node:fs/promises'
import type { SimpleGit } from 'simple-git'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import { parseNulSeparatedPaths, toLiteralPathspec } from './gitPathParsing'

// 記録の範囲(スナップショットに何が入っていないか)の判定。一覧・1 ファイルの diff・戻す操作のどれもが使う知識なので、
// 照会の種類に依らないこのファイルにまとめる

/** 記録の blob が object の DB から消えた(git gc --prune=now など。確認の結果 12) */
export const AGENT_BASELINE_BLOB_MISSING_MESSAGE =
  '実行前の内容が見つかりません（git gc などで消えた可能性があります）'

// 記録のインデックスが指す blob が無いと、diff は `fatal: unable to read <sha>` で失敗する。途中の実行の tree が無いと、
// diff-tree・tree どうしの diff は `fatal: bad object <sha>` で失敗する(計画の時点に git 2.50.1 で実測)。分かる文言に置き換える
export function toBaselineQueryError(error: unknown): unknown {
  return error instanceof Error && /(?:unable to read|bad object) [0-9a-f]{7,}/.test(error.message)
    ? new Error(AGENT_BASELINE_BLOB_MISSING_MESSAGE, { cause: error })
    : error
}

/** 記録が見つからないときの文言(記録のインデックス・隠れた git が消えた。git の fatal をそのまま見せない) */
export const AGENT_BASELINE_RECORD_MISSING_MESSAGE = '記録が見つかりません'

/**
 * 隠れた git(gitDir が文字列)が、シンボリックリンクでないディレクトリであることを確かめる(無ければ git は
 * `fatal: not a git repository` で失敗する。差し替えられたリンクの先を使わない。L-002・L-437)。リポジトリの方式(null)は何もしない
 */
export async function assertBaselineGitDir(
  snapshot: Pick<BaselineSnapshot, 'gitDir'>
): Promise<void> {
  if (snapshot.gitDir === null) return
  const stat = await lstat(snapshot.gitDir).catch(() => null)
  if (stat === null || !stat.isDirectory()) throw new Error(AGENT_BASELINE_RECORD_MISSING_MESSAGE)
}

/**
 * 累積の一覧・diff の前提: 記録のインデックス(消えていると git は空の index として扱い、全体が追加に見える)と、隠れた git の場所
 */
export async function assertBaselineRecord(
  snapshot: Pick<BaselineSnapshot, 'indexPath' | 'gitDir'>
): Promise<void> {
  const stat = await lstat(snapshot.indexPath).catch(() => null)
  if (stat === null || !stat.isFile()) throw new Error(AGENT_BASELINE_RECORD_MISSING_MESSAGE)
  await assertBaselineGitDir(snapshot)
}

// 記録の時点の ignore 済みの一覧(node_modules の中がまとまらない構成では数万行になりうる)を、一覧の行ごとに走査しないための索引。
// 記録ごとに 1 度だけ作る(記録は作った後に変えない)。
// `--directory` の出力のフォルダの行には 2 種類ある: ignore されたフォルダ('node_modules/'。中の行は続かない)と、
// 未追跡の中身がすべて ignore されていたフォルダ('build/' の後に 'build/cache/' などが続く)。後者はフォルダごと ignore されて
// いたわけではなく、記録の後に足されたファイルを含みうるため、中の行が続かないフォルダだけを「フォルダごと」とみなす
interface IgnoredIndex {
  files: Set<string>
  wholeDirs: Set<string>
  sorted: string[]
}
const ignoredIndexCache = new WeakMap<readonly string[], IgnoredIndex>()

function ignoredIndexOf(snapshot: BaselineSnapshot): IgnoredIndex {
  const cached = ignoredIndexCache.get(snapshot.ignoredAtBaseline)
  if (cached !== undefined) return cached
  // 'd/' の配下('d/...')は、並べると 'd/' の直後に連続する('/' より小さい文字で続く 'd-x' などは 'd/' より前に来る)
  const sorted = [...snapshot.ignoredAtBaseline].sort()
  const files = new Set<string>()
  const wholeDirs = new Set<string>()
  sorted.forEach((path, i) => {
    if (!path.endsWith('/')) files.add(path)
    else if (!(sorted[i + 1] ?? '').startsWith(path)) wholeDirs.add(path)
  })
  const index = { files, wholeDirs, sorted }
  ignoredIndexCache.set(snapshot.ignoredAtBaseline, index)
  return index
}

/**
 * そのパス(末尾の '/' の有無を問わない)が、記録の時点に ignore されていたか。ignore されていたファイルと一致するか、
 * そのパス自体か祖先('a/')がフォルダごと ignore されていたフォルダなら真(--directory で 1 行にまとまっている)
 */
export function isIgnoredAtBaseline(snapshot: BaselineSnapshot, path: string): boolean {
  const { files, wholeDirs } = ignoredIndexOf(snapshot)
  const trimmed = path.endsWith('/') ? path.slice(0, -1) : path
  if (files.has(trimmed) || wholeDirs.has(`${trimmed}/`)) return true
  for (let slash = trimmed.indexOf('/'); slash !== -1; slash = trimmed.indexOf('/', slash + 1)) {
    if (wholeDirs.has(trimmed.slice(0, slash + 1))) return true
  }
  return false
}

// 記録の時点の ignore 済みの一覧に、dirPath で始まるものがあるか(二分探索)
function hasIgnoredAtBaselineUnder(snapshot: BaselineSnapshot, dirPath: string): boolean {
  const { sorted } = ignoredIndexOf(snapshot)
  let low = 0
  let high = sorted.length
  while (low < high) {
    const mid = (low + high) >> 1
    if (sorted[mid] < dirPath) low = mid + 1
    else high = mid
  }
  return low < sorted.length && sorted[low].startsWith(dirPath)
}

/**
 * フォルダ('<dir>/')の配下に、記録から除外したファイル・記録から外した入れ子のリポジトリ・記録の時点に ignore されていた
 * ファイルやフォルダがあるか(前方一致)。dirPath は末尾の '/' を含むこと('a/' が 'ab/...' に一致しないように)
 */
export function containsNotRecorded(snapshot: BaselineSnapshot, dirPath: string): boolean {
  return (
    snapshot.excluded.some((file) => file.path.startsWith(dirPath)) ||
    snapshot.skippedRepos.some((repo) => repo.startsWith(dirPath)) ||
    hasIgnoredAtBaselineUnder(snapshot, dirPath)
  )
}

/**
 * そのパス自体を記録していないか(除外したファイル・コミットの無い入れ子のリポジトリは完全一致。記録の時点に ignore されて
 * いたものは祖先のフォルダを含む)。filePath はリポジトリ相対で末尾の '/' を落としたもの。入れ子のリポジトリは '<sub>/' で
 * 控えているので '/' を足して比べる
 */
export function isNotRecordedPath(snapshot: BaselineSnapshot, filePath: string): boolean {
  return (
    snapshot.excluded.some((file) => file.path === filePath) ||
    snapshot.skippedRepos.some((repo) => repo === `${filePath}/`) ||
    isIgnoredAtBaseline(snapshot, filePath)
  )
}

/**
 * 新しいフォルダ('<dir>/')の中に、ignore されたファイル・フォルダがあるか。記録のインデックスは ignore されたファイルを
 * 持たないため、記録の前から ignore されたファイルだけを持っていたフォルダも「新しいフォルダ」の 1 行にまとまる。
 * それをフォルダごとゴミ箱へ移すと、実行の前からあったファイル(.env・ローカルの DB など)も移る(Task 6 レビュー I1)。
 * 一覧(まとめない判断)と戻す(実行の時点での拒否)の両方が使う。git は記録のインデックスで問い合わせるもの
 */
export async function hasIgnoredInside(git: SimpleGit, dir: string): Promise<boolean> {
  const output = await git.raw([
    'ls-files',
    '-z',
    '--others',
    '--ignored',
    '--exclude-standard',
    '--directory',
    '--',
    toLiteralPathspec(dir.endsWith('/') ? dir : `${dir}/`)
  ])
  return parseNulSeparatedPaths(output).length > 0
}
