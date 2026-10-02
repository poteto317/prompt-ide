import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

interface Options {
  /** この要素の中にあるフォーカスも戻す対象にする(ダイアログのフォーム。中で disabled になった要素に残ったフォーカス) */
  containerRef?: RefObject<HTMLElement | null>
  /** false なら何もしない(例: エラーが無い=成功のときは、成功の後のフォーカスの要求に任せる)。既定は true */
  enabled?: boolean
}

// 実行中は入力欄やボタンが disabled になり、ブラウザはフォーカスを body に落とす。失敗して実行中が解けても
// body のままだと、キーボードの利用者が戻れない(ダイアログでは Escape がフォームに届かず閉じられない)。
// そのため実行中が true→false になったとき、フォーカスが body(または containerRef の中)にあれば対象へ戻す。
// 外の要素にあるフォーカスは奪わない(パターン 86)。RemoteSetupInputDialog・CreateTagDialog・RemoteSetupBanner で
// 共通(パターン 55)。直前の実行中の状態は部品ごとの ref のため、初回のマウントでは何もせず、アンマウントで消える
export function useFocusOnRunningEnd(
  isRunning: boolean,
  targetRef: RefObject<HTMLButtonElement | HTMLInputElement | null>,
  { containerRef, enabled = true }: Options = {}
): void {
  const wasRunningRef = useRef(isRunning)
  useEffect(() => {
    const wasRunning = wasRunningRef.current
    wasRunningRef.current = isRunning
    if (!wasRunning || isRunning || !enabled) return
    const target = targetRef.current
    if (target === null || target.disabled) return
    const active = document.activeElement
    if (active === null || active === document.body || containerRef?.current?.contains(active)) {
      target.focus()
    }
    // targetRef・containerRef は描画をまたいで同じ ref のため、実際に effect を走らせるのは実行中と enabled の変化
  }, [isRunning, enabled, targetRef, containerRef])
}
