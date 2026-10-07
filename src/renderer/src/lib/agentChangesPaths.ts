import { toAgentChangeRelativePath } from '@shared/types'
import { isPathAtOrInside, joinPath } from './pathUtils'

// エージェントの変更の一覧の行パスと、開いているフォルダの絶対パスの橋渡し。
// 戻すの確認の文言(useAgentChangesRevert)とセクションの印(AgentChangesSection)が同じ判定を使うため、1 か所に置く

/** 一覧の行のパス('<dir>/' を含む)の絶対パス。フォルダを開いていなければ null */
export function agentChangeAbsolutePath(
  folderPath: string | null,
  entryPath: string
): string | null {
  return folderPath === null ? null : joinPath(folderPath, toAgentChangeRelativePath(entryPath))
}

/** 記録を始めた後にアプリで保存したファイルか(フォルダなら配下を含む) */
export function isSavedInApp(savedPaths: ReadonlySet<string>, absolutePath: string): boolean {
  return [...savedPaths].some((saved) => isPathAtOrInside(saved, absolutePath))
}

/** 一覧の行が、記録を始めた後にアプリで保存したものか。フォルダを開いていなければ false */
export function isEntrySavedInApp(
  folderPath: string | null,
  savedPaths: ReadonlySet<string>,
  entryPath: string
): boolean {
  const absolutePath = agentChangeAbsolutePath(folderPath, entryPath)
  return absolutePath !== null && isSavedInApp(savedPaths, absolutePath)
}
