import type { AgentChangesUndoSummary, AgentRevertResult } from '@shared/types'
import type { AgentChangesWriteHooks } from './useAgentChangesWriteRunner'

// エージェントの変更を書き換える操作(戻す操作・取り消し)の後の同期の共通部分。取り直しの順序(useAgentChangesWiring が
// 取り直す対象を決めて両方の hook へ渡す)と、useAgentChangesRevert・useAgentChangesUndo が控えの要約を写しへ反映する規則を、1 か所に置く

export interface AgentChangesWriteRefreshers {
  refreshTree: () => Promise<unknown>
  refreshGitStatus: () => Promise<void>
  /** エージェントの変更の一覧を取り直す(useAgentChanges.refresh) */
  refreshChanges: () => Promise<void>
  /** 開いている diff タブを取り直す(useDiffOperations.refreshDiff) */
  refreshDiff: () => void
}

/** 成功・失敗のどちらでも、ツリー・git status・一覧・diff タブを取り直す(状態が変わりうる。ツリーと git status の失敗は握る) */
export async function refreshAfterAgentChangesWrite({
  refreshTree,
  refreshGitStatus,
  refreshChanges,
  refreshDiff
}: AgentChangesWriteRefreshers): Promise<void> {
  await refreshTree().catch(() => undefined)
  await refreshGitStatus().catch(() => undefined)
  await refreshChanges()
  refreshDiff()
}

/**
 * 結果の控えの要約を、実行中の印を下ろす前に写しへ反映する。例外では main の控えが変わったかが分からないため、帯を隠して
 * 一覧の取り直しを待つ(L-039)。startedAt は依頼の時点の写しの記録の開始の時刻。
 * 型引数は run の結果の型(すべて戻すの status を失わないよう、run の推論を execute の戻り値に任せる)
 */
export function undoSummaryWriteHooks<T extends Pick<AgentRevertResult, 'undoSummary'>>(
  applyUndoSummary: (summary: AgentChangesUndoSummary | null, startedAt: number) => void,
  startedAt: number
): AgentChangesWriteHooks<T> {
  return {
    onResult: (result) => applyUndoSummary(result.undoSummary, startedAt),
    onError: () => applyUndoSummary(null, startedAt)
  }
}
