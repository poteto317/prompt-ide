import type { AgentChangeEntry } from '@shared/types'
import { isAgentRevertAllTarget } from '@shared/types'
import type { ListedAgentChanges } from './agentChangesScope'

// すべて戻すの対象の絞り込み(2026-10-13 の設計書の利用者の変更との区別の「すべて戻すの対象」)。表示中の一覧から、対象の行と
// 除く行の件数を求める。対象の定義は shared の isAgentRevertAllTarget(確認の一覧と main の照合が同じ定義を使う。L-036)。
// 押せない理由の優先順位は agentChangesAvailability.ts、文言は agentChangesMessages.ts に置く

/** すべて戻すの対象と除く行の件数(agentRevertAllTargets の結果) */
export interface AgentRevertAllTargets {
  /** 対象の行(利用者の変更・利用者の変更を含む行を除いたもの)。一覧が無ければ空 */
  targets: AgentChangeEntry[]
  /** 除く行の件数(確認の文言に使う)。一覧が無ければ 0 */
  excludedCount: number
  /** セクションの除く旨に使う件数。累積の一覧が無い・打ち切った一覧(残りの行の author も分からない)・実行の範囲の一覧なら 0 */
  shownExcludedCount: number
  /** 行が 1 件以上あり、すべてが除く行(すべて戻すの押せない理由に使う) */
  hasOnlyUserChanges: boolean
}

/**
 * 表示中の一覧から、すべて戻すの対象と除く行の件数を求める(isAgentRevertAllTarget。確認の一覧と main の照合が同じ定義を使う。L-036)。
 * useAgentChangesRevert が、押せない理由・確認の文言・main へ渡す expected・セクションの除く旨に使う
 */
export function agentRevertAllTargets(list: ListedAgentChanges | null): AgentRevertAllTargets {
  if (list === null) {
    return { targets: [], excludedCount: 0, shownExcludedCount: 0, hasOnlyUserChanges: false }
  }
  const targets = list.entries.filter(isAgentRevertAllTarget)
  const excludedCount = list.entries.length - targets.length
  return {
    targets,
    excludedCount,
    shownExcludedCount: list.scope.kind !== 'all' || list.truncated ? 0 : excludedCount,
    hasOnlyUserChanges: list.entries.length > 0 && targets.length === 0
  }
}
