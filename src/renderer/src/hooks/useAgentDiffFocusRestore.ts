import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export interface AgentDiffFocusRestore {
  /** エディタの領域(EditorPanel の外枠)に付ける */
  panelRef: RefObject<HTMLDivElement | null>
  /** 「このハンクを実行前に戻す」の onClick の先頭で呼ぶ */
  reserveFocusRestore: () => void
}

// エージェントの変更の diff タブで、ハンクを戻した後のフォーカス(パターン 86・152)。押したボタンは実行中に disabled になり、
// 成功すると diff の取り直しで消え、最後のハンクならタブごと閉じる。どれもフォーカスが body に落ちる。
// 押したときに予約し、描画の後の effect で、フォーカスが body(またはエディタの領域の中の押せないボタン)にあるときだけ、
// アクティブなタブ(role="tab")へ戻す。タブが閉じた後は、次にアクティブになったタブへ戻す。タブが無くなったら予約は捨てる。
// 利用者がエディタの領域の外へ移したフォーカスは奪わない。effect は依存配列を持たず、毎描画の後に走る
export function useAgentDiffFocusRestore(): AgentDiffFocusRestore {
  const panelRef = useRef<HTMLDivElement>(null)
  const isReservedRef = useRef(false)
  const reserveFocusRestore = (): void => {
    isReservedRef.current = true
  }

  useEffect(() => {
    if (!isReservedRef.current) return
    const panel = panelRef.current
    const active = document.activeElement
    const isInPanel = active !== null && panel?.contains(active) === true
    const isLost =
      active === null ||
      active === document.body ||
      (isInPanel && active instanceof HTMLButtonElement && active.disabled)
    if (isLost) {
      isReservedRef.current = false
      panel?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
      return
    }
    // 利用者がエディタの領域の外へ移したフォーカスは奪わない
    if (!isInPanel) isReservedRef.current = false
  })

  return { panelRef, reserveFocusRestore }
}
