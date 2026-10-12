import type { AgentChangesScope } from '@shared/types'
import type { AgentChangesView } from '../types'
import {
  buildAgentChangesHeading,
  buildAgentChangesRunHeading,
  describeAgentChangesScopeUnavailable
} from './agentChangesMessages'
import { findAgentChangesRun, getListedAgentChanges } from './agentChangesScope'

// セクション「エージェントの変更」の、写しと選んでいる範囲から決まる文字(見出し・範囲の一覧が取れない理由)。
// AgentChangesSection から外して、描画なしで検査できるようにする

/**
 * 見出し。範囲が実行で、写しの実行の一覧にあれば実行の番号と期間を、それ以外は累積の始点を添える。
 * 件数は範囲の一覧が取れているときだけ(打ち切る前の全件数)
 */
export function buildAgentChangesSectionHeading(
  view: AgentChangesView,
  scope: AgentChangesScope
): string {
  if (view.kind !== 'recording') return buildAgentChangesHeading(null)
  const totalCount = getListedAgentChanges(view)?.totalCount ?? null
  const selectedRun = scope.kind === 'run' ? findAgentChangesRun(view.runs, scope.runId) : undefined
  return selectedRun !== undefined
    ? buildAgentChangesRunHeading(selectedRun, totalCount)
    : buildAgentChangesHeading({ startedAt: view.startedAt, totalCount })
}

/**
 * 範囲の一覧が取れない(写しが古い)理由。run-missing は useAgentChanges が累積に戻して取り直すため出さない(null)。
 * 一覧が取れない状態でなければ null
 */
export function describeAgentChangesListUnavailable(view: AgentChangesView): string | null {
  if (view.kind !== 'recording' || view.list?.kind !== 'scope-unavailable') return null
  const { reason, scope } = view.list
  if (reason === 'run-missing') return null
  return describeAgentChangesScopeUnavailable(
    reason,
    scope.kind === 'run' ? findAgentChangesRun(view.runs, scope.runId) : undefined
  )
}
