import { useLayoutEffect, useRef } from 'react'
import type { FocusEvent, RefObject } from 'react'

// 帯の 中断 が消えたときのフォーカスの移し先(AgentTerminalPanel が使う。設計書 2026-10-19「フォーカス」)。
// セッションが終わって 中断 が消えたとき、フォーカスが body に落ちていれば同じ帯の主ボタン(終了 が替わった 起動)へ移す。
// 起動 が disabled なら focus() が効かないため、帯にいつもある開閉のボタンへ移す。ターミナルへは移さない(続けて押した Enter が
// claude の書きかけを送信しうる)。奪わない判定は activeElement だけに任せる(利用者がパネルの外へ移していれば body ではない)

export interface AgentInterruptFocusTargets {
  /** 中断 のボタン */
  interruptRef: RefObject<HTMLButtonElement | null>
  /** 同じ帯の主ボタン(起動・終了) */
  primaryButtonRef: RefObject<HTMLButtonElement | null>
  /** 帯の開閉のボタン(主ボタンが disabled のときの移し先) */
  toggleRef: RefObject<HTMLButtonElement | null>
}

/** 戻り値はパネル(section)の onFocus に渡す(focusin で泡立つ。パネルの中で最後にフォーカスを受けた要素が 中断 かを控える) */
export function useAgentInterruptFocus(
  visible: boolean,
  { interruptRef, primaryButtonRef, toggleRef }: AgentInterruptFocusTargets
): (event: FocusEvent<HTMLElement>) => void {
  // パネルの中で最後にフォーカスを受けた要素が 中断 か(onFocus だけで控える)。onBlur では消さない:
  // ウィンドウが非アクティブになったときや、Chromium が要素を DOM から外すときにも blur が出るため
  const lastFocusedWasInterruptRef = useRef(false)
  const wasVisibleRef = useRef(visible)

  useLayoutEffect(() => {
    const wasVisible = wasVisibleRef.current
    wasVisibleRef.current = visible
    if (!wasVisible || visible) return
    const shouldMove = lastFocusedWasInterruptRef.current
    // 移した・移さないに関わらず控えを戻す(古い控えを次の回に残さない)
    lastFocusedWasInterruptRef.current = false
    if (!shouldMove) return
    const active = document.activeElement
    if (active !== null && active !== document.body) return
    const primary = primaryButtonRef.current
    if (primary !== null && !primary.disabled) primary.focus()
    else toggleRef.current?.focus()
  }, [visible, primaryButtonRef, toggleRef])

  return (event) => {
    lastFocusedWasInterruptRef.current = event.target === interruptRef.current
  }
}
