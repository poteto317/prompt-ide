import { useEffect } from 'react'
import type { RefObject } from 'react'

// Tab で移れる要素。disabled(`:disabled`。disabled の fieldset の中も含む)と tabindex=-1 は除く
const FOCUSABLE_SELECTOR =
  'a[href], button, input:not([type="hidden"]), select, textarea, [tabindex], [contenteditable="true"]'

function listFocusable(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.matches(':disabled') && element.tabIndex >= 0
  )
}

// モーダルのダイアログ(aria-modal="true")の中で Tab / Shift+Tab を循環させ、背後の画面へフォーカスを出さない。
// Tab は document の capture で受ける(フォーカスがダイアログの外や body にあっても受けられる。QuickOpenDialog と
// 同じ理由)。操作対象は押すたびに列挙し直す: 実行中は入力欄やボタンが disabled になって対象が減るため(パターン 86)。
// - 中にあるとき: 次(Shift なら前)の対象へ。末尾の次は先頭、先頭の前は末尾
// - 外・body にあるとき: 先頭(Shift なら末尾)へ入れる
// - 対象が 0 件(実行中にすべて disabled)のとき: ダイアログ自体へ置く(tabindex が無ければ -1 を付ける)
// IME の変換中(isComposing)は奪わない(変換候補の操作に Tab を使う IME がある)
export function useDialogFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  isOpen: boolean
): void {
  useEffect(() => {
    if (!isOpen) return
    const handleTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab' || event.isComposing) return
      const container = containerRef.current
      if (container === null) return
      event.preventDefault()
      const items = listFocusable(container)
      if (items.length === 0) {
        if (!container.hasAttribute('tabindex')) container.tabIndex = -1
        container.focus()
        return
      }
      const active = document.activeElement
      const index = active instanceof HTMLElement ? items.indexOf(active) : -1
      if (index === -1) {
        items[event.shiftKey ? items.length - 1 : 0].focus()
        return
      }
      const step = event.shiftKey ? -1 : 1
      items[(index + step + items.length) % items.length].focus()
    }
    document.addEventListener('keydown', handleTab, true)
    return () => document.removeEventListener('keydown', handleTab, true)
    // containerRef は描画をまたいで同じ ref のため、実際に effect を張り直すのは isOpen の変化
  }, [containerRef, isOpen])
}
