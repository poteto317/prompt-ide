import { useLayoutEffect, useRef } from 'react'
import type { RefObject } from 'react'

export interface RemovedItemFocusState<T extends HTMLElement> {
  /** フォーカスを移す範囲(外すボタンを探す・ボタンが無くなったときの置き場。tabIndex={-1} を付ける) */
  containerRef: RefObject<T | null>
  /** 外すボタンを押したときに、その位置(一覧の中の添字)を控える */
  markRemoved: (index: number) => void
}

// 一覧の項目を外すボタンを押したときの、フォーカスの移し先(外した位置の次のボタン。末尾なら前、無くなったら範囲そのもの)。
// 押したボタンは消えるので、items が変わった描画の後に移す(body に落とさない)。selector で外すボタンを探す
export function useRemovedItemFocus<T extends HTMLElement>(
  items: unknown,
  selector: string
): RemovedItemFocusState<T> {
  const containerRef = useRef<T>(null)
  const pendingIndexRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const index = pendingIndexRef.current
    const container = containerRef.current
    if (index === null || container === null) return
    pendingIndexRef.current = null
    const buttons = container.querySelectorAll<HTMLElement>(selector)
    const next = buttons.length === 0 ? null : buttons.item(Math.min(index, buttons.length - 1))
    if (next !== null) next.focus()
    else container.focus()
    // selector は呼び出し側の定数なので、移すのは実質 items が変わった後だけ
  }, [items, selector])

  const markRemoved = (index: number): void => {
    pendingIndexRef.current = index
  }

  return { containerRef, markRemoved }
}
