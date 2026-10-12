'use client'
import { useId } from 'react'
import type { AgentChangesRun, AgentChangesScope } from '@shared/types'
import {
  AGENT_CHANGES_SCOPE_LABEL,
  formatAgentChangesAllScopeOption,
  formatAgentChangesRunOption
} from '../../lib/agentChangesMessages'
import {
  AGENT_CHANGES_ALL_SCOPE,
  decodeAgentChangesScopeValue,
  encodeAgentChangesScopeValue
} from '../../lib/agentChangesScope'

interface Props {
  /** 累積の始点の時刻 */
  startedAt: number
  /** 実行の一覧(古い順。新しい順に並べて出す) */
  runs: readonly AgentChangesRun[]
  scope: AgentChangesScope
  /** 選べない間(戻す操作の実行中)は true */
  disabled: boolean
  /** 押せない理由の要素の id(disabled のときだけ aria-describedby で結ぶ。無ければ null) */
  disabledReasonId: string | null
  onSelect: (scope: AgentChangesScope) => void
}

// 「エージェントの変更」の範囲の選択(設計書「範囲の選択の UI」)。見える文字のラベル「表示」とネイティブの <select>
// (選択の状態と disabled を支援技術へそのまま伝え、最大 11 項目を狭いサイドバーで縦に場所を取らずに並べる)。
// 新しい実行ほど見る機会が多いので上に置く。選べない実行は disabled の項目にし、理由を項目の文字に含める(L-057)
export default function AgentChangesScopeSelect({
  startedAt,
  runs,
  scope,
  disabled,
  disabledReasonId,
  onSelect
}: Props): React.JSX.Element {
  const selectId = useId()
  const newestFirst = [...runs].sort((a, b) => b.runId - a.runId)
  return (
    <div className="agent-changes__scope">
      <label htmlFor={selectId} className="agent-changes__scope-label">
        {AGENT_CHANGES_SCOPE_LABEL}
      </label>
      <select
        id={selectId}
        className="agent-changes__scope-select"
        value={encodeAgentChangesScopeValue(scope)}
        disabled={disabled}
        aria-describedby={disabled && disabledReasonId !== null ? disabledReasonId : undefined}
        onChange={(event) => {
          const next = decodeAgentChangesScopeValue(event.target.value)
          if (next !== null) onSelect(next)
        }}
      >
        <option value={encodeAgentChangesScopeValue(AGENT_CHANGES_ALL_SCOPE)}>
          {formatAgentChangesAllScopeOption(startedAt)}
        </option>
        {newestFirst.map((run) => (
          <option
            key={run.runId}
            value={encodeAgentChangesScopeValue({ kind: 'run', runId: run.runId })}
            disabled={run.availability.kind !== 'available'}
          >
            {formatAgentChangesRunOption(run)}
          </option>
        ))}
      </select>
    </div>
  )
}
