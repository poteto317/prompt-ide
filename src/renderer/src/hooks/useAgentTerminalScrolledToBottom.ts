// src/renderer/src/hooks/useAgentTerminalScrolledToBottom.ts
import { useCallback, useSyncExternalStore } from 'react'
import type { AgentTerminalController } from '../lib/agentTerminalController'

// 選択中のタブのターミナルの表示が画面の末尾にあるか(描画用。帯の 許可 の押せない理由に使う。設計書 2026-11-06「押せるかの判定」)。
// xterm のスクロール(利用者のスクロール・末尾が進んだ)と出力の書き込みの通知と、ターミナルの大きさの変化(行を増やすと xterm は
// スクロールの通知を出さずに表示の位置と末尾を動かしうる)をきっかけに読み直す。タイマーは持たない。購読は
// controller が替わる・外れるときに外す(useSyncExternalStore)。押した時点の判定は controller.isScrolledToBottom() を直接読む

export function useAgentTerminalScrolledToBottom(
  controller: Pick<
    AgentTerminalController,
    'isScrolledToBottom' | 'onScroll' | 'onOutputWritten' | 'onResized'
  >
): boolean {
  const subscribe = useCallback(
    (onChange: () => void): (() => void) => {
      const unsubscribeScroll = controller.onScroll(onChange)
      const unsubscribeOutput = controller.onOutputWritten(onChange)
      const unsubscribeResized = controller.onResized(onChange)
      return () => {
        unsubscribeScroll()
        unsubscribeOutput()
        unsubscribeResized()
      }
    },
    [controller]
  )
  const getSnapshot = useCallback((): boolean => controller.isScrolledToBottom(), [controller])
  return useSyncExternalStore(subscribe, getSnapshot)
}
