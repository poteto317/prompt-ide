'use client'
import { useEffect, useRef } from 'react'
import type { AgentTerminalController } from '../../lib/agentTerminalController'
import * as agentTerminalApi from '../../lib/agentTerminalApi'
import { AGENT_TERMINAL_ATTRIBUTE } from '../../lib/agentTerminalKeys'

/** 大きさの変化が落ち着いてから fit するまでの待ち時間(ミリ秒) */
export const AGENT_TERMINAL_RESIZE_DEBOUNCE_MS = 50

interface Props {
  controller: AgentTerminalController
  /** パネルが開いているか。表示し直したとき・大きさが変わったときに fit する */
  isVisible: boolean
  /** F6 でターミナルから抜けるときの移動先へフォーカスを移す */
  onFocusOut: () => void
}

// xterm の表示の領域。xterm は controller が持ち、ここは取り付け・取り外しと fit の契機だけを受け持つ
export default function AgentTerminalView({
  controller,
  isVisible,
  onFocusOut
}: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (container === null) return
    controller.attach(container)
    return () => controller.detach(container)
  }, [controller])

  useEffect(() => {
    controller.setFocusOutHandler(onFocusOut)
    return () => controller.setFocusOutHandler(null)
  }, [controller, onFocusOut])

  useEffect(() => {
    const container = containerRef.current
    if (!isVisible || container === null) return
    controller.fit()
    // jsdom には ResizeObserver が無い(テストでは偽物に差し替えて確かめる)
    if (typeof ResizeObserver === 'undefined') return
    // ドラッグ中などの連続した変化では fit(と main への大きさの送信)を繰り返さず、落ち着いてから 1 回だけ行う
    // (デバウンスは controller ではなく呼ぶ側の責務。Task 16)
    let timer: ReturnType<typeof setTimeout> | null = null
    const observer = new ResizeObserver(() => {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        controller.fit()
      }, AGENT_TERMINAL_RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
      if (timer !== null) clearTimeout(timer)
    }
  }, [controller, isVisible])

  // Windows・Linux でメニューのショートカットを止める・戻す(main が判断する)
  const handleFocus = (): void => agentTerminalApi.setAgentTerminalFocused(true)
  const handleBlur = (event: React.FocusEvent<HTMLDivElement>): void => {
    // relatedTarget の型は EventTarget | null。要素どうしのフォーカスの移動では Node か null なので、Node のときだけ比べる
    const next = event.relatedTarget
    if (next instanceof Node && event.currentTarget.contains(next)) return
    agentTerminalApi.setAgentTerminalFocused(false)
  }

  return (
    <div
      ref={containerRef}
      className="agent-terminal-view"
      // ターミナルの中のキーを document のハンドラが除外する目印(探す側の isInsideAgentTerminal と同じ定数)
      {...{ [AGENT_TERMINAL_ATTRIBUTE]: '' }}
      role="group"
      aria-label="エージェントのターミナル"
      onFocus={handleFocus}
      onBlur={handleBlur}
    />
  )
}
