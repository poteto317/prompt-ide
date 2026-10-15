import type { AgentChangeEntry, AgentChangesListResult, AgentChangesScope } from '@shared/types'
import type { AttributedEntries } from './agentChangesAttribution'
import { getAgentChangeDiff, getAgentChangeDiffBetween } from './agentChangeDiff'
import { listAgentChanges, listAgentChangesBetween } from './agentChangesQuery'
import type { AgentChangesRecord } from './agentChangesRecord'
import { summarizeAgentChangesRecord } from './agentChangesRecord'
import { resolveAgentChangesScope } from './agentChangesScope'

// 範囲ごとの一覧と diff(設計書「範囲ごとの一覧と diff」)。範囲を記録のどの記録で比べるかに解決し(agentChangesScope)、
// 累積・最後の実行は作業ツリーとの比較、途中の実行は tree どうしの比較へ振り分ける。IPC の受け口(agentChangesHandlers)から、
// 記録の列(withRecord)の中で呼ぶ: 列の外で区切りの場所を控えると、保持の上限で外した区切りの一時ディレクトリが一覧の途中で消える(L-004)。
// 累積の一覧の行だけ attributeEntries(registry の行の author)に通し、結果の区別の要約はその後に求める(今の区間の比較で lost になった
// 記録の要約を同じ結果で返す。そのとき限りの印 unassignedNow はその結果の要約にだけ入れる)

export const AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE =
  'この実行の変更は表示できません（記録がありません）'

/**
 * 範囲の一覧。選べない範囲(写しが古い)は一覧を作らず理由を返す。累積の行だけ attributeEntries で author を付ける(実行の範囲は
 * 一覧の関数が作った author: null のまま)。区別の要約は attributeEntries の後に求め、そのとき限りの印(unassignedNow)を
 * その結果の要約の hadUnassignedSince にだけ入れる(記録は変えない)
 */
export async function listAgentChangesInScope(
  record: AgentChangesRecord,
  scope: AgentChangesScope,
  attributeEntries: (entries: AgentChangeEntry[]) => Promise<AttributedEntries>
): Promise<AgentChangesListResult> {
  const common = (
    unassignedNow = false
  ): Omit<Extract<AgentChangesListResult, { kind: 'scope-unavailable' }>, 'kind' | 'reason'> => ({
    ...summarizeAgentChangesRecord(record, { unassignedNow }),
    scope
  })
  const resolved = resolveAgentChangesScope(record, scope)
  switch (resolved.kind) {
    case 'unavailable':
      return { kind: 'scope-unavailable', ...common(), reason: resolved.reason }
    case 'between': {
      const list = await listAgentChangesBetween(resolved.start, resolved.end)
      return { kind: 'recording', ...common(), ...list }
    }
    case 'toWorktree': {
      const list = await listAgentChanges(resolved.snapshot)
      return { kind: 'recording', ...common(), ...list }
    }
    case 'cumulative': {
      const list = await listAgentChanges(resolved.snapshot)
      const { entries, unassignedNow } = await attributeEntries(list.entries)
      return { kind: 'recording', ...common(unassignedNow), ...list, entries }
    }
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
