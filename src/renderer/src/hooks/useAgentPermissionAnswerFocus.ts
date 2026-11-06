import { useLayoutEffect, useRef } from 'react'
import type { FocusEvent, RefObject } from 'react'

// 帯の 許可・拒否 が消えたときのフォーカスの移し先(AgentTerminalPanel が使う。設計書 2026-11-06「フォーカス」)。答えて許可待ちが終わると
// 2 つのボタンは消える。パネルの中で最後にフォーカスを受けたのが 許可・拒否 で、移す時点のフォーカスが body(または null)なら、帯にいつもあり
// disabled にならない開閉のボタン(エージェント)へ移す。中断(許可した後は作業中になり、続けて押した Enter で許可した作業を止める)・
// 終了(会話を失う)・ターミナル(続けて押した Enter・数字が CLI の入力になる)へは移さない(L-408)。作りは useAgentInterruptFocus と同じ

export interface AgentPermissionAnswerFocusTargets {
  allowRef: RefObject<HTMLButtonElement | null>
  denyRef: RefObject<HTMLButtonElement | null>
  /** 帯の開閉のボタン(移し先) */
  toggleRef: RefObject<HTMLButtonElement | null>
}

/** 戻り値はパネル(section)の onFocus に渡す(focusin で泡立つ。パネルの中で最後にフォーカスを受けた要素が 許可・拒否 かを控える) */
export function useAgentPermissionAnswerFocus(
  visible: boolean,
  { allowRef, denyRef, toggleRef }: AgentPermissionAnswerFocusTargets
): (event: FocusEvent<HTMLElement>) => void {
  // onFocus だけで控える。onBlur では消さない(ウィンドウが非アクティブになったときや、Chromium が要素を DOM から外すときにも blur が出るため)
  const lastFocusedWasAnswerRef = useRef(false)
  const wasVisibleRef = useRef(visible)

  useLayoutEffect(() => {
    const wasVisible = wasVisibleRef.current
    wasVisibleRef.current = visible
    if (!wasVisible || visible) return
    const shouldMove = lastFocusedWasAnswerRef.current
    // 移した・移さないに関わらず控えを戻す(古い控えを次の回に残さない)
    lastFocusedWasAnswerRef.current = false
    if (!shouldMove) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    toggleRef.current?.focus()
  }, [visible, toggleRef])

  return (event) => {
    lastFocusedWasAnswerRef.current =
      event.target === allowRef.current || event.target === denyRef.current
  }
}
