import type { AgentChangesUndoResult, AgentChangesUndoSummary } from '@shared/types'
import { agentChangeAbsolutePath } from './agentChangesPaths'

// 直前の戻す操作の取り消しと、開いているタブの橋渡し(useAgentChangesUndo から外して、描画なしで検査できるようにする)。
// どのタブを確かめる・読み直す・閉じるかは、控えの要約と main の結果だけで決める(L-001・L-008)

// リポジトリ相対のパスを絶対パスにする(フォルダを開いていなければ空。確かめる・読み直す・閉じるで同じ規則)
function absolutePathsOf(folderPath: string | null, paths: readonly string[]): string[] {
  return paths.flatMap((path) => {
    const absolutePath = agentChangeAbsolutePath(folderPath, path)
    return absolutePath === null ? [] : [absolutePath]
  })
}

/**
 * 取り消しの確認の前に未保存の編集を確かめるパス(絶対パス)。作り直すパス(今は無い)を除き、書き戻す・ゴミ箱へ移すパスだけ。
 * フォルダを開いていなければ空
 */
export function agentUndoDirtyCheckPaths(
  folderPath: string | null,
  summary: AgentChangesUndoSummary
): string[] {
  return absolutePathsOf(
    folderPath,
    summary.entries.filter((entry) => entry.action !== 'recreate').map((entry) => entry.path)
  )
}

/**
 * 取り消しの結果で同期するタブ: 書き戻した・作り直したパス(restoredPaths)は読み直し、ゴミ箱へ移したパス(trashedPaths)は閉じる
 * (絶対パス。フォルダを開いていなければ空)
 */
export function planAgentUndoTabSync(
  folderPath: string | null,
  result: Pick<AgentChangesUndoResult, 'restoredPaths' | 'trashedPaths'>
): { reloadPaths: string[]; closePaths: string[] } {
  return {
    reloadPaths: absolutePathsOf(folderPath, result.restoredPaths),
    closePaths: absolutePathsOf(folderPath, result.trashedPaths)
  }
}
