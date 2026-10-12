import type { AgentChangesListResult, AgentChangesScope } from '@shared/types'
import { getAgentChangeDiff, getAgentChangeDiffBetween } from './agentChangeDiff'
import { listAgentChanges, listAgentChangesBetween } from './agentChangesQuery'
import type { AgentChangesRecord } from './agentChangesRecord'
import { summarizeAgentChangesRuns } from './agentChangesRecord'
import { resolveAgentChangesScope } from './agentChangesScope'

// 範囲ごとの一覧と diff(設計書「範囲ごとの一覧と diff」)。範囲を記録のどの記録で比べるかに解決し(agentChangesScope)、
// 累積・最後の実行は作業ツリーとの比較、途中の実行は tree どうしの比較へ振り分ける。IPC の受け口(agentChangesHandlers)から、
// 記録の列(withRecord)の中で呼ぶ: 列の外で区切りの場所を控えると、保持の上限で外した区切りの一時ディレクトリが一覧の途中で消える(L-004)

export const AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE =
  'この実行の変更は表示できません（記録がありません）'

/** 範囲の一覧。選べない範囲(写しが古い)は一覧を作らず理由を返す */
export async function listAgentChangesInScope(
  record: AgentChangesRecord,
  scope: AgentChangesScope
): Promise<AgentChangesListResult> {
  const common = {
    startedAt: record.baseline.startedAt,
    runs: summarizeAgentChangesRuns(record),
    scope
  }
  const resolved = resolveAgentChangesScope(record, scope)
  switch (resolved.kind) {
    case 'unavailable':
      return { kind: 'scope-unavailable', ...common, reason: resolved.reason }
    case 'between':
      return {
        kind: 'recording',
        ...common,
        ...(await listAgentChangesBetween(resolved.start, resolved.end))
      }
    default:
      return { kind: 'recording', ...common, ...(await listAgentChanges(resolved.snapshot)) }
  }
}

/** 範囲の 1 ファイルの diff。選べない範囲は例外 */
export async function getAgentChangeDiffInScope(
  record: AgentChangesRecord,
  scope: AgentChangesScope,
  relativePath: string
): Promise<string> {
  const resolved = resolveAgentChangesScope(record, scope)
  if (resolved.kind === 'unavailable') {
    throw new Error(AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE)
  }
  if (resolved.kind === 'between') {
    return getAgentChangeDiffBetween(resolved.start, resolved.end, relativePath)
  }
  return getAgentChangeDiff(resolved.snapshot, relativePath)
}
