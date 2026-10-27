'use client'
import { useId } from 'react'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import type { AgentCliKindPanelState } from '../../types'
import {
  AGENT_CLI_ATTRIBUTION_PRECISION_NOTES,
  AGENT_CLI_KIND_SECTION_NOTE,
  AGENT_CLI_KIND_SECTION_TITLE,
  agentCliFallbackNote,
  agentCliKindOptionLabel,
  agentCliUnsupportedFeaturesNote,
  isAgentCliKindResaveAllowed
} from '../../lib/agentCliMessages'

// 設定パネルの「使うエージェント CLI」(設計書 2026-10-20「設定」の「画面」)。ExecutionModeSection と同じ作りで、選ぶとすぐ保存する
// (見た目も同じ class)。選択肢は能力の表から作り、選んだ CLI で使えない機能と、区別の精度の注記を出す。押す前から選べない間(読み込み中・起動中)は
// disabled にする(押した処理の側でも同じ条件で止める。L-058)。切り替えの途中は押した結果として起きる状態で、disabled にすると
// フォーカスを持つ押した選択肢が押せなくなってフォーカスが body に落ちるため、aria-disabled にして押しても選ばない(L-157)。
// 押した処理の側(runSwitching の再入防止)でも止める
export default function AgentCliKindSection({
  kind,
  fallback,
  saveError,
  isLocked,
  isSwitching,
  lockedReason,
  onSelect
}: AgentCliKindPanelState): React.JSX.Element {
  const labelId = useId()
  const reasonId = useId()
  const unsupportedNote = kind === null ? null : agentCliUnsupportedFeaturesNote(kind)
  const precisionNote = kind === null ? null : AGENT_CLI_ATTRIBUTION_PRECISION_NOTES[kind]
  const fallbackNote = agentCliFallbackNote(fallback)
  return (
    <div className="settings-panel__section">
      <p className="settings-panel__label" id={labelId}>
        {AGENT_CLI_KIND_SECTION_TITLE}
      </p>
      <p className="settings-panel__note">{AGENT_CLI_KIND_SECTION_NOTE}</p>
      <div role="radiogroup" aria-labelledby={labelId} className="execution-mode-section__options">
        {AGENT_CLI_KINDS.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={kind === option}
            // 読み込み前に選ぶと、保存の失敗・後から届く読み込みでの上書きになるため、kind が null の間も選べなくする
            disabled={isLocked || kind === null}
            aria-disabled={isSwitching ? true : undefined}
            aria-describedby={lockedReason !== null ? reasonId : undefined}
            className={`execution-mode-section__option${kind === option ? ' execution-mode-section__option--selected' : ''}`}
            onClick={() => {
              if (isSwitching) return
              // 選択中のものは押しても何もしない。ただし不正な値の間は、注記のとおり選び直しで保存する
              if (kind !== option || isAgentCliKindResaveAllowed(fallback)) onSelect(option)
            }}
          >
            {agentCliKindOptionLabel(option)}
          </button>
        ))}
      </div>
      {unsupportedNote !== null && <p className="settings-panel__note">{unsupportedNote}</p>}
      {precisionNote !== null && <p className="settings-panel__note">{precisionNote}</p>}
      {fallbackNote !== null && <p className="settings-panel__status">{fallbackNote}</p>}
      {lockedReason !== null && (
        <p className="settings-panel__status" id={reasonId}>
          {lockedReason}
        </p>
      )}
      {kind === null && <p className="settings-panel__status">読み込み中...</p>}
      {saveError !== null && (
        <p className="settings-panel__error" role="alert">
          {saveError}
        </p>
      )}
    </div>
  )
}
