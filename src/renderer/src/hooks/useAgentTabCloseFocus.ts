import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

// エージェントのセッションのタブを × で閉じるときのフォーカスの移し先(AgentTerminalPanel が使う)。
// closeTab の dispose は host を DOM から外すため、ターミナルのフォーカスは beforeClose で先に帯へ逃がす(パターン 86)。
// 閉じても閉じなくても(取りやめ・失敗)、選択中のタブへフォーカスを移す。× はマウスでしか押せず、選択中でないタブの × を
// 押して取りやめたときに、閉じようとしたタブ(aria-selected=false・tabIndex=-1)へ戻すとタブ列の「選択とフォーカスを
// 一緒に移す」約束から外れるため(閉じようとしたタブが選択中なら結果は同じ)。× は Tab の順・支援技術から外しているため
// × には戻さない。ローカルレビュー第 2 周の指摘 1 で変更
// ただし、閉じ終えた時点でフォーカスがまだ「逃がした先」(beforeClose で移した要素・document.body・タブ列〈role="tablist"〉の中)に
// あるときだけ移す。停止は最大で数秒かかり、その間に利用者がエディタや別のタブのターミナルへフォーカスを移していたら、
// 奪うと入力がタブに入り Delete・Backspace でタブが閉じてしまうため。ローカルレビュー第 3 周の指摘 1 で変更
// パネル(section)の中を広く「逃がした先」と見なすと、別のタブのターミナル・帯のほかのボタン(起動・最大化など)へ移した
// フォーカスも奪うため、タブ列の中に絞る。ローカルレビュー第 4 周の指摘 1 で変更
export function useAgentTabCloseFocus(
  sectionRef: RefObject<HTMLElement | null>,
  closeTab: (slotId: string) => Promise<boolean>,
  beforeClose: () => void
): (slotId: string) => Promise<void> {
  // タブを閉じ終えた(閉じなかった)後に、選択中のタブへフォーカスを移す依頼(再描画の後の選択中のタブへ移すため effect で処理する)
  const [focusSelectedTabRequest, setFocusSelectedTabRequest] = useState(0)
  // beforeClose の直後のフォーカスの位置(逃がした先)。閉じ終えた時点でまだここにあるかを確かめる
  const escapedFocusRef = useRef<Element | null>(null)

  useEffect(() => {
    if (focusSelectedTabRequest === 0) return
    const active = document.activeElement
    const section = sectionRef.current
    const tabList = section?.querySelector('[role="tablist"]') ?? null
    const stillEscaped =
      active === null ||
      active === document.body ||
      active === escapedFocusRef.current ||
      (tabList !== null && tabList.contains(active))
    if (!stillEscaped) return
    section?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus()
  }, [sectionRef, focusSelectedTabRequest])

  return async (slotId: string): Promise<void> => {
    beforeClose()
    escapedFocusRef.current = document.activeElement
    try {
      await closeTab(slotId)
    } catch (error) {
      // 失敗は握り(unhandled rejection にしない)、取りやめと同じくフォーカスを戻す
      console.error('エージェントのタブを閉じられませんでした', error)
    }
    setFocusSelectedTabRequest((count) => count + 1)
  }
}
