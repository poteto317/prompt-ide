import type { AgentChangesScope, AgentChangesScopeUnavailableReason } from '@shared/types'
import type { BaselineSnapshot } from './agentBaselineSnapshot'
import type { AgentChangesRecord } from './agentChangesRecord'
import { runStartSnapshot } from './agentChangesRecord'

// 範囲(renderer が渡す列挙と runId)を、記録のどの記録で比べるかに解決する(設計書「範囲の解決」)。renderer の値は範囲の指定だけで、
// どの記録のインデックス・tree を使うかは main が決める(L-019)。runId は git の引数に入らない(L-034)。
// 呼ぶのは registry の withRecord(所有者の列)の中だけ。列の外で解決した区切りは、保持の上限で外されて消えることがある(L-004)

export type ResolvedAgentChangesScope =
  /** 累積: 始点 → 作業ツリー */
  | { kind: 'cumulative'; snapshot: BaselineSnapshot }
  /** 最後の実行: 開始の記録 → 作業ツリー(累積と同じ比べ方) */
  | { kind: 'toWorktree'; snapshot: BaselineSnapshot }
  /** 途中の実行: 開始の記録の tree → 次の実行の開始の記録の tree */
  | { kind: 'between'; start: BaselineSnapshot; end: BaselineSnapshot }
  | { kind: 'unavailable'; reason: AgentChangesScopeUnavailableReason }

export function resolveAgentChangesScope(
  record: AgentChangesRecord,
  scope: AgentChangesScope
): ResolvedAgentChangesScope {
  if (scope.kind === 'all') return { kind: 'cumulative', snapshot: record.baseline }
  const index = record.runs.findIndex((run) => run.runId === scope.runId)
  if (index === -1) return { kind: 'unavailable', reason: 'run-missing' }
  const start = runStartSnapshot(record, record.runs[index])
  if (start === null) return { kind: 'unavailable', reason: 'start-not-recorded' }
  const next = record.runs[index + 1]
  if (next === undefined) return { kind: 'toWorktree', snapshot: start }
  // 終わりの無い実行を「今まで」や次の取れた区切りまでに読み替えない(別の実行の変更が混ざる。L-002)
  const end = runStartSnapshot(record, next)
  if (end === null) return { kind: 'unavailable', reason: 'end-not-recorded' }
  return { kind: 'between', start, end }
}
