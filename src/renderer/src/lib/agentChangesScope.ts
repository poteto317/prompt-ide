import type { AgentChangesRun, AgentChangesScope } from '@shared/types'
import type { AgentChangesView, AgentChangesViewList } from '../types'

// エージェントの変更の範囲(累積・実行 N)の写しの読み方と、範囲の選択(<select>)の値の符号化。
// 行を読む部品(戻す・diff タブの同期・セクション)が同じ規則で一覧・実行を取り出す

/** 累積の範囲(既定) */
export const AGENT_CHANGES_ALL_SCOPE: AgentChangesScope = { kind: 'all' }

export type ListedAgentChanges = Extract<AgentChangesViewList, { kind: 'listed' }>

/** 写しの一覧のうち、行を持つもの(記録中で、範囲の一覧が取れている)。記録なし・取り直す前・範囲の一覧が取れないときは null */
export function getListedAgentChanges(view: AgentChangesView): ListedAgentChanges | null {
  return view.kind === 'recording' && view.list?.kind === 'listed' ? view.list : null
}

/** runId の実行(無ければ undefined) */
export function findAgentChangesRun(
  runs: readonly AgentChangesRun[],
  runId: number
): AgentChangesRun | undefined {
  return runs.find((run) => run.runId === runId)
}

const ALL_SCOPE_VALUE = 'all'
const RUN_SCOPE_VALUE_PREFIX = 'run:'

/** 範囲の選択(<select>)の項目の値。累積は 'all'、実行は 'run:<runId>' */
export function encodeAgentChangesScopeValue(scope: AgentChangesScope): string {
  return scope.kind === 'all' ? ALL_SCOPE_VALUE : `${RUN_SCOPE_VALUE_PREFIX}${scope.runId}`
}

/** 範囲の選択の項目の値を範囲に戻す。形が違えば null(選択を変えない) */
export function decodeAgentChangesScopeValue(value: string): AgentChangesScope | null {
  if (value === ALL_SCOPE_VALUE) return { kind: 'all' }
  if (!value.startsWith(RUN_SCOPE_VALUE_PREFIX)) return null
  const runId = Number(value.slice(RUN_SCOPE_VALUE_PREFIX.length))
  return Number.isSafeInteger(runId) ? { kind: 'run', runId } : null
}
