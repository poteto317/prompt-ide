'use client'
import type { AgentChangeEntry } from '@shared/types'
import { toAgentChangeRelativePath } from '@shared/types'
import {
  AGENT_CHANGES_NOT_RECORDED_MARK,
  AGENT_CHANGES_SAVED_MARK
} from '../../lib/agentChangesMessages'

interface Props {
  entry: AgentChangeEntry
  /** 記録を始めた後にアプリで保存したファイル(フォルダなら配下を含む)か */
  savedInApp: boolean
  /** 戻すボタンを押せない理由(押せるなら null)。表示はセクションの 1 か所 */
  disabledReason: string | null
  /** 理由の要素の id(aria-describedby で参照する。パターン 126) */
  disabledReasonId: string
  onOpenDiff: (path: string) => void
  onRevert: (entry: AgentChangeEntry) => void
}

// 「エージェントの変更」の 1 行(状態の文字・diff を開くパス・印・戻すボタン)。押せる条件の判定は useAgentChangesRevert
export default function AgentChangesFileItem({
  entry,
  savedInApp,
  disabledReason,
  disabledReasonId,
  onOpenDiff,
  onRevert
}: Props): React.JSX.Element {
  const revertLabel =
    entry.status === 'A' ? `${entry.path} をゴミ箱へ移動` : `${entry.path} を実行前の状態に戻す`
  return (
    <li className="agent-changes__item">
      <span className="source-control-panel__file-status source-control-panel__file-status--changed">
        {entry.status}
      </span>
      <button
        type="button"
        className="source-control-panel__file-path agent-changes__path"
        onClick={() => onOpenDiff(toAgentChangeRelativePath(entry.path))}
        aria-label={`${entry.path} のエージェントの変更を表示`}
      >
        {entry.path}
      </button>
      {savedInApp && <span className="agent-changes__mark">{AGENT_CHANGES_SAVED_MARK}</span>}
      {entry.notRecorded ? (
        <span className="agent-changes__mark">{AGENT_CHANGES_NOT_RECORDED_MARK}</span>
      ) : (
        <button
          type="button"
          className="agent-changes__revert"
          aria-label={revertLabel}
          title={revertLabel}
          disabled={disabledReason !== null}
          aria-describedby={disabledReason !== null ? disabledReasonId : undefined}
          onClick={() => onRevert(entry)}
        >
          ↶
        </button>
      )}
    </li>
  )
}
