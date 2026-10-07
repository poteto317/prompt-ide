import { lstat } from 'node:fs/promises'
import type { SimpleGit } from 'simple-git'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import { parseNulSeparatedPaths, toLiteralPathspec } from './gitPathParsing'

// 記録の範囲(スナップショットに何が入っていないか)の判定。一覧・1 ファイルの diff・戻す操作のどれもが使う知識なので、
// 照会の種類に依らないこのファイルにまとめる

/** 記録の blob が object の DB から消えた(git gc --prune=now など。確認の結果 12) */
export const AGENT_BASELINE_BLOB_MISSING_MESSAGE =
  '実行前の内容が見つかりません（git gc などで消えた可能性があります）'

// 記録のインデックスが指す blob が無いと、diff は `fatal: unable to read <sha>` で失敗する。分かる文言に置き換える
export function toBaselineQueryError(error: unknown): unknown {
  return error instanceof Error && /unable to read [0-9a-f]{7,}/.test(error.message)
    ? new Error(AGENT_BASELINE_BLOB_MISSING_MESSAGE, { cause: error })
    : error
}

/** 記録のインデックスが消えていると git は空の index として扱い、リポジトリ全体が追加に見える。先に確かめる */
export async function assertBaselineIndex(indexPath: string): Promise<void> {
  const stat = await lstat(indexPath).catch(() => null)
  if (stat === null || !stat.isFile()) throw new Error('記録が見つかりません')
}

/**
 * フォルダ('<dir>/')の配下に、記録から除外したファイル・記録から外した入れ子のリポジトリがあるか(前方一致)。
 * dirPath は末尾の '/' を含むこと('a/' が 'ab/...' に一致しないように)
 */
export function containsNotRecorded(snapshot: BaselineSnapshot, dirPath: string): boolean {
  return (
    snapshot.excluded.some((file) => file.path.startsWith(dirPath)) ||
    snapshot.skippedRepos.some((repo) => repo.startsWith(dirPath))
  )
}

/**
 * そのパス自体を記録していないか(除外したファイル・コミットの無い入れ子のリポジトリ。完全一致)。
 * filePath はリポジトリ相対で末尾の '/' を落としたもの。入れ子のリポジトリは '<sub>/' で控えているので '/' を足して比べる
 */
export function isNotRecordedPath(snapshot: BaselineSnapshot, filePath: string): boolean {
  return (
    snapshot.excluded.some((file) => file.path === filePath) ||
    snapshot.skippedRepos.some((repo) => repo === `${filePath}/`)
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
