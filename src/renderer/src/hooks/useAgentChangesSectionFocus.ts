import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'

export interface AgentChangesSectionFocusOptions {
  /** セクションを描画しているか(描画しない間は依頼を受け取らない) */
  isVisible: boolean
  /** 見出しへフォーカスを移す依頼があるか(ターミナルの帯の「変更を確認」) */
  isFocusRequested: boolean
  /** フォーカスを移したら呼ぶ(依頼を下ろす) */
  consumeFocusRequest: () => void
  /** 折りたたみを開く。effect の依存に入るため、参照が安定したものを渡す */
  openSection: () => void
}

export interface AgentChangesSectionFocus {
  /** 見出しのボタン(折りたたみの切り替え)に付ける */
  headingRef: RefObject<HTMLButtonElement | null>
  /** セクションの要素に付ける(フォーカスがセクションの中かを判定する) */
  sectionRef: RefObject<HTMLElement | null>
  /** 押すと disabled になる・消えるボタンの onClick の先頭で呼ぶ */
  reserveFocusRestore: () => void
}

// セクション「エージェントの変更」のフォーカス制御(パターン 86・152)。
// 1. 「変更を確認」の依頼があれば、折りたたみを開いて見出しへフォーカスを移し、依頼を下ろす。描画しない間は下ろさない
//    (セクションが現れたときに受け取る)
// 2. 押したボタンが disabled になる・消えると、フォーカスが body に落ちる。押したときに予約し、描画の後の effect で、
//    フォーカスが body(またはセクションの中の押せない要素)にあるときだけ見出しへ戻す。
//    利用者がセクションの外へ移したフォーカスは奪わない
// コンポーネントの早期 return(描画しない間)より前で呼ぶこと。2 の effect は依存配列を持たず、毎描画の後に走る
export function useAgentChangesSectionFocus({
  isVisible,
  isFocusRequested,
  consumeFocusRequest,
  openSection
}: AgentChangesSectionFocusOptions): AgentChangesSectionFocus {
  const headingRef = useRef<HTMLButtonElement>(null)
  const sectionRef = useRef<HTMLElement>(null)
  const isFocusRestoreReservedRef = useRef(false)
  const reserveFocusRestore = (): void => {
    isFocusRestoreReservedRef.current = true
  }

  useEffect(() => {
    if (!isVisible || !isFocusRequested) return
    // 折りたたんでいたら開いてから移す
    openSection()
    headingRef.current?.focus()
    consumeFocusRequest()
  }, [isVisible, isFocusRequested, consumeFocusRequest, openSection])

  useEffect(() => {
    if (!isFocusRestoreReservedRef.current) return
    const heading = headingRef.current
    // 従来の方式で確認を終えるとセクションごと消え、戻す先が無い(予約は捨てる)
    if (heading === null) {
      isFocusRestoreReservedRef.current = false
      return
    }
    const active = document.activeElement
    const isLost =
      active === null ||
      active === document.body ||
      (sectionRef.current?.contains(active) === true &&
        active instanceof HTMLButtonElement &&
        active.disabled)
    if (isLost) {
      isFocusRestoreReservedRef.current = false
      heading.focus()
      return
    }
    // 利用者がセクションの外へ移したフォーカスは奪わない
    if (sectionRef.current?.contains(active) !== true) isFocusRestoreReservedRef.current = false
  })

  return { headingRef, sectionRef, reserveFocusRestore }
}
