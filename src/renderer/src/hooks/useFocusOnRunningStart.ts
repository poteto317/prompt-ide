import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

interface Options {
  /** この要素の中にあるフォーカスも移す対象にする(ダイアログのフォーム。中で disabled になった要素に残ったフォーカス) */
  containerRef?: RefObject<HTMLElement | null>
}

// 実行が始まると入力欄や実行ボタンが disabled になり、ブラウザはフォーカスを body に落とす。実行中も押せる対象
// (clone の `キャンセル` など)へ移すため、実行中が false→true になったとき、フォーカスが body(または containerRef
// の中)にあれば対象へ移す。外の要素にあるフォーカスは奪わない(パターン 86)。useFocusOnRunningEnd の対になる処理。
// 直前の実行中の状態は部品ごとの ref のため、初回のマウントでは何もせず、アンマウントで消える
export function useFocusOnRunningStart(
  isRunning: boolean,
  targetRef: RefObject<HTMLButtonElement | HTMLInputElement | null>,
  { containerRef }: Options = {}
): void {
  const wasRunningRef = useRef(isRunning)
  useEffect(() => {
    const wasRunning = wasRunningRef.current
    wasRunningRef.current = isRunning
    if (wasRunning || !isRunning) return
    const active = document.activeElement
    if (active === null || active === document.body || containerRef?.current?.contains(active)) {
      targetRef.current?.focus()
    }
    // targetRef・containerRef は描画をまたいで同じ ref のため、実際に effect を走らせるのは実行中の変化
  }, [isRunning, targetRef, containerRef])
}
