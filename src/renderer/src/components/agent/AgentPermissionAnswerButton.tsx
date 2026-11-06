'use client'
import { useId } from 'react'
import type { Ref } from 'react'
import type { AgentPermissionAnswerButtonState } from '../../lib/agentPermissionAnswerView'

interface Props {
  /** 見える文字(許可・拒否) */
  label: string
  state: AgentPermissionAnswerButtonState
  onPress: () => void
  ref?: Ref<HTMLButtonElement>
}

// 帯の 許可・拒否 のボタン 1 つ分(設計書 2026-11-06「画面」)。中断 と同じ作り: 押せない理由は見える文字にしない(隠した span の
// aria-describedby と title だけ。理由がボタンで違いうるので、説明の要素はボタンごと)。
// disabled ではなく aria-disabled: 答えて押せなくなっても、フォーカスを body に落とさない(L-157)。押せない状態で押したときは hook が
// 理由を読み上げて送らない。1,000ms の待ち・読み直し待ち(useAgentPermissionAnswerCooldown)・同期の再入の防止(useAgentPermissionAnswer)と、
// ダブルクリック・キーリピートの無視(ここ)と、ボタンが消えたときの移し先(useAgentPermissionAnswerFocus)は組で働く(L-408)
export default function AgentPermissionAnswerButton({
  label,
  state,
  onPress,
  ref
}: Props): React.JSX.Element {
  const reasonId = useId()
  const { disabledReason, ariaLabel } = state
  return (
    <>
      {disabledReason !== null && (
        <span id={reasonId} hidden>
          {disabledReason}
        </span>
      )}
      <button
        ref={ref}
        type="button"
        className="agent-terminal-panel__button"
        aria-label={ariaLabel}
        aria-disabled={disabledReason !== null ? true : undefined}
        aria-describedby={disabledReason !== null ? reasonId : undefined}
        title={disabledReason ?? undefined}
        onClick={(event) => {
          // ダブルクリック・ダブルタップの 2 回目は捨てる(キーボードのクリックは detail が 0 で影響しない)
          if (event.detail > 1) return
          onPress()
        }}
        onKeyDown={(event) => {
          // 押し続けた Enter・Space のリピートで、続けて出た許可の確認に答えない(単発の打鍵は止めない)
          if (event.repeat && (event.key === 'Enter' || event.key === ' ')) event.preventDefault()
        }}
      >
        {label}
      </button>
    </>
  )
}
