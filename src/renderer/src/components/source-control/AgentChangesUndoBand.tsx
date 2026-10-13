'use client'
import type { AgentChangesUndoSummary } from '@shared/types'
import {
  AGENT_CHANGES_UNDO_BUTTON,
  formatAgentChangesUndoBandText,
  formatAgentChangesUndoButtonLabel,
  formatAgentChangesUndoTarget
} from '../../lib/agentChangesMessages'

export interface AgentChangesUndoBandProps {
  summary: AgentChangesUndoSummary
  /** 押せない理由(押せるなら null。帯の中に見える文字で出し aria-describedby で結ぶ) */
  disabledReason: string | null
  /** 理由の要素の id(セクションが useId で作る。押せない確認を終える・範囲の選択もこの要素を指すことがある) */
  reasonId: string
  /** 押したとき(セクションがフォーカスの予約と取り消しを行う) */
  onUndo: () => void
}

// セクション「エージェントの変更」の帯「直前に戻した操作」(設計書「セクションの帯」)。一覧が空になった後も見える位置
// (範囲の選択の直後)に出す。結果の読み上げはセクションの常設の aria-live が行うため、帯は role="alert"・aria-live を持たない。
// 押せない理由は帯の中に見える文字で出して aria-describedby で結ぶ(L-057)。戻す操作の続きの入力(ダブルクリックの 2 回目・
// キーリピート)が逆の操作に届かないようにする(L-408。PromptItemView・AgentSendConfirmDialog と同じ)
export default function AgentChangesUndoBand({
  summary,
  disabledReason,
  reasonId,
  onUndo
}: AgentChangesUndoBandProps): React.JSX.Element {
  const target = formatAgentChangesUndoTarget(summary)
  const isDisabled = disabledReason !== null
  const bandText = formatAgentChangesUndoBandText(target)
  return (
    <div className="agent-changes__undo">
      {/* 狭い幅では末尾(ファイル名の側)が省略されるため、全文をツールチップにも出す */}
      <p className="agent-changes__undo-text" title={bandText}>
        {bandText}
      </p>
      <button
        type="button"
        className="agent-changes__button agent-changes__undo-button"
        disabled={isDisabled}
        aria-describedby={isDisabled ? reasonId : undefined}
        aria-label={formatAgentChangesUndoButtonLabel(target)}
        onClick={(event) => {
          if (event.detail > 1) return
          onUndo()
        }}
        onKeyDown={(event) => {
          if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
        }}
      >
        {AGENT_CHANGES_UNDO_BUTTON}
      </button>
      {isDisabled && (
        <p id={reasonId} className="agent-changes__note agent-changes__undo-reason">
          {disabledReason}
        </p>
      )}
    </div>
  )
}
