import { lstat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertBaselineGitDir,
  assertBaselineRecord,
  isNotRecordedPath,
  toBaselineQueryError
} from './agentBaselineCoverage'
import { createBaselineGit, RECORD_WORKTREE_DIFF_ARGS } from './agentBaselineGit'
import type { BaselineGitOptions } from './agentBaselineGit'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import { PATCH_FORMAT_ARGS, PATCH_FORMAT_CONFIG } from './gitDiffArgs'
import { parseNulSeparatedPaths, toLiteralPathspec } from './gitPathParsing'
import { getDiff } from './gitService'

// エージェントの変更の 1 ファイルの diff(設計書「確認の結果」5)。記録のインデックス(GIT_INDEX_FILE)と作業ツリーを比べる。
// blob を書かず、利用者の .git/index を変えない

/** 記録していないファイル・フォルダの diff の代わりの 1 行 */
export const NOT_RECORDED_DIFF_MESSAGE =
  '記録の時点では内容を保存していないため、差分を表示できません\n'

/** 追加されたフォルダの diff の代わりの 1 行(DiffView はハンクの無い行を説明として出す) */
export function buildAddedFolderDiffMessage(fileCount: number): string {
  return `フォルダが追加されました（${fileCount} 件のファイル）\n`
}

/**
 * 1 ファイルの diff(記録の時点 → いまの作業ツリー)。filePath はリポジトリ相対(末尾の '/' は落ちている)。
 * - 記録の時点にあったファイル: 記録のインデックスでの git diff(getDiff と同じ引数・-U3)
 * - 記録の後に現れたフォルダ: 中のファイルの数の 1 行
 * - 記録の後に現れたファイル: 未追跡の疑似 diff(getDiff の未追跡の扱いと同じ。大きさ・バイナリ・リンクの判定を含む)
 */
export async function getAgentChangeDiff(
  snapshot: BaselineSnapshot,
  filePath: string,
  options: BaselineGitOptions = {}
): Promise<string> {
  const { folderPath } = snapshot
  await assertBaselineRecord(snapshot)
  if (isNotRecordedPath(snapshot, filePath)) {
    return NOT_RECORDED_DIFF_MESSAGE
  }
  const literal = toLiteralPathspec(filePath)
  const git = createBaselineGit(snapshot, {
    ...options,
    config: ['core.quotePath=false', ...PATCH_FORMAT_CONFIG]
  })
  const inBaseline = parseNulSeparatedPaths(await git.raw(['ls-files', '-z', '--', literal]))
  if (inBaseline.includes(filePath)) {
    // 入れ子のリポジトリの中の命令(filter など)を動かさない(RECORD_WORKTREE_DIFF_ARGS。gitlink は HEAD の違いだけを出す)
    return git
      .raw(['diff', ...PATCH_FORMAT_ARGS, ...RECORD_WORKTREE_DIFF_ARGS, '-U3', '--', literal])
      .catch((error: unknown) => {
        throw toBaselineQueryError(error)
      })
  }
  const stat = await lstat(join(folderPath, filePath)).catch(() => null)
  if (stat === null) return ''
  if (stat.isDirectory()) {
    const files = parseNulSeparatedPaths(
      await git.raw([
        'ls-files',
        '-z',
        '--others',
        '--exclude-standard',
        '--',
        toLiteralPathspec(`${filePath}/`)
      ])
    )
    return buildAddedFolderDiffMessage(files.length)
  }
  return getDiff(folderPath, filePath, false, true)
}

/**
 * 途中の実行の 1 ファイルの diff(開始の区切り start の tree → 次の区切り end の tree)。getDiff と同じ引数(-U3)。
 * 追加・削除のファイルも git の出力のまま。どちらかの端で記録しなかったパスは、記録していない旨の 1 行。
 * tree どうしの比較で、利用者の index と作業ツリーを読まない
 */
export async function getAgentChangeDiffBetween(
  start: BaselineSnapshot,
  end: BaselineSnapshot,
  filePath: string,
  options: BaselineGitOptions = {}
): Promise<string> {
  if (isNotRecordedPath(start, filePath) || isNotRecordedPath(end, filePath)) {
    return NOT_RECORDED_DIFF_MESSAGE
  }
  await assertBaselineGitDir(start)
  const git = createBaselineGit(start, {
    ...options,
    config: ['core.quotePath=false', ...PATCH_FORMAT_CONFIG]
  })
  return git
    .raw([
      'diff',
      ...PATCH_FORMAT_ARGS,
      '-U3',
      start.tree,
      end.tree,
      '--',
      toLiteralPathspec(filePath)
    ])
    .catch((error: unknown) => {
      throw toBaselineQueryError(error)
    })
}
