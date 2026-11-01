'use client'
import { useId } from 'react'
import type { Ref } from 'react'

interface Props {
  ref?: Ref<HTMLInputElement>
  value: string
  onChange: (value: string) => void
  /** 確定の Enter で呼ぶ(変換の確定とキーリピートでは呼ばない) */
  onSubmit: () => void
  /** 送れない理由の要素の id。フォーカスが欄に残っていても理由が伝わるように説明へ結びつける */
  describedBy?: string
  /** 全文が送れない状態か(送り先の都合で送れないときは入力の誤りではないので false) */
  invalid: boolean
}

// 送信前の確認の引数の欄。本文の直後へ付ける 1 行の入力
export default function AgentSendArgumentField({
  ref,
  value,
  onChange,
  onSubmit,
  describedBy,
  invalid
}: Props): React.JSX.Element {
  const inputId = useId()
  return (
    <div className="agent-send-confirm__argument-field">
      <label htmlFor={inputId} className="agent-send-confirm__argument-label">
        引数（任意）
      </label>
      <input
        ref={ref}
        id={inputId}
        type="text"
        className="agent-send-confirm__argument"
        value={value}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          // IME の変換の確定とキーリピートでは送らない
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || e.keyCode === 229 || e.repeat)
            return
          e.preventDefault()
          onSubmit()
        }}
      />
    </div>
  )
}
