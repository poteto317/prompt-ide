import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

interface Options {
  /** ダイアログの操作の実行中か(開いたボタンが disabled になる間)。解けるまでフォーカスを戻さない */
  isRunning: boolean
  /** 開くときに呼ぶ(前回の失敗の表示を消す clearError など)。開く前に呼ぶ */
  onOpen?: () => void
  /** 開いたボタンの ref(戻す先)。呼び出し元が作ってボタンに付ける(ref を戻り値に含めると、描画中に
   *  戻り値を読むたびに react-hooks/refs に「描画中の ref の参照」とみなされるため) */
  openerRef: RefObject<HTMLButtonElement | null>
}

export interface DialogFocusReturn {
  isOpen: boolean
  /** onOpen を呼んでから開く */
  open: () => void
  /** 閉じて、開いたボタンへフォーカスを戻す予約を立てる(キャンセル・Escape・オーバーレイのクリック、
   *  成功の後に開いたボタンへ戻す場合) */
  close: () => void
  /** 閉じるだけで戻さない(成功の後に、次の操作のボタンへ移す要求と組む場合) */
  closeWithoutReturn: () => void
}

// ボタンで開くダイアログの開閉と、閉じた後に開いたボタンへフォーカスを戻す処理
// (NotRepositoryView・RemoteSetupBanner・HistorySection で共通。パターン 55)。
// 閉じる時点で直接 focus() せず、「戻す予約」(ref)を立てるだけにする。成功の経路では実行中フラグの解除が
// まだ再描画に反映されておらず、disabled のボタンへの focus() は無視されてフォーカスが body に落ちる
// (パターン 73・86)。そのため、ダイアログが閉じて実行中でもなくなった描画の後(useEffect)で戻す。
// 戻すのはフォーカスが行き場を失っている(閉じたダイアログの中にあって body に落ちた)ときだけで、
// 実行中に利用者が外へ移した先は奪わない。予約は部品ごとの ref のため、アンマウントで消え、
// フォルダの切り替え等で別のボタンへ持ち越さない
export function useDialogFocusReturn({ isRunning, onOpen, openerRef }: Options): DialogFocusReturn {
  const [isOpen, setIsOpen] = useState(false)
  const restoreFocusPendingRef = useRef(false)

  const open = (): void => {
    onOpen?.()
    setIsOpen(true)
  }
  const close = (): void => {
    restoreFocusPendingRef.current = true
    setIsOpen(false)
  }
  const closeWithoutReturn = (): void => {
    setIsOpen(false)
  }

  // onOpen は毎回変わる参照のため effect では使わない。openerRef は描画をまたいで同じ ref のため、
  // 実際に effect を走らせるのは開閉と実行中の変化
  useEffect(() => {
    if (!restoreFocusPendingRef.current || isOpen || isRunning) return
    restoreFocusPendingRef.current = false
    const active = document.activeElement
    if (active === null || active === document.body) openerRef.current?.focus()
  }, [isOpen, isRunning, openerRef])

  return { isOpen, open, close, closeWithoutReturn }
}
