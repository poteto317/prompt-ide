'use client'
import { useEffect, useRef } from 'react'
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
import type { RemoteSetupFocusTarget } from '../../lib/remoteSetupState'

export interface ActionMenuItem {
  id: string
  label: string
  /** 見える文字と読み上げの名前が違うとき(`プル中...` と `プル中`)に付ける */
  ariaLabel?: string
  disabled?: boolean
  /** menuitemcheckbox にする */
  checked?: boolean
  onSelect: () => void
}

interface Props {
  buttonLabel: string
  buttonContent: React.ReactNode
  buttonClassName?: string
  /** data-remote-setup-focus の値 */
  focusTarget?: RemoteSetupFocusTarget
  items: ActionMenuItem[]
}

const ENABLED_ITEM_SELECTOR = 'button:not(:disabled)'

const focusFirstEnabledItem = (menu: HTMLUListElement | null): void => {
  menu?.querySelector<HTMLButtonElement>(ENABLED_ITEM_SELECTOR)?.focus()
}

// ソース管理の小さなメニュー(ツールバーの「…」、コミットボタンの ▾)。開閉と閉じた後のフォーカスの戻りは
// useDialogFocusReturn に任せる(実行でボタンが押せなくなっても、押せるようになった描画の後で戻す)。
// 項目は tabIndex -1 で、Tab の順に入れない(↑↓ で移す)。Enter・Space の実行はボタンの click に任せる
export default function ActionMenu({
  buttonLabel,
  buttonContent,
  buttonClassName,
  focusTarget,
  items
}: Props): React.JSX.Element {
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const isButtonDisabled = items.every((item) => item.disabled)
  const { isOpen, open, close, closeWithoutReturn } = useDialogFocusReturn({
    isRunning: isButtonDisabled,
    openerRef: buttonRef
  })

  // 外側の判定はボタンを含むルートで行う(開いたままボタンを押して閉じるとき、ここで閉じると click で開き直す)。
  // 途中で伝播を止める部品があっても閉じるよう capture で受ける。伝播は止めないので、他のメニューの外側の扱いを妨げない
  useEffect(() => {
    if (!isOpen) return
    const handlePointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      closeWithoutReturn()
    }
    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [isOpen, closeWithoutReturn])

  // 無効の項目やメニューの余白を押すと、フォーカスが body へ落ち、Escape も ↑↓ も届かなくなるため、離した時点で項目へ戻す。
  // 外側を押した場合は pointerdown で閉じていて、ここには来ない
  useEffect(() => {
    if (!isOpen) return
    const handlePointerUp = (): void => {
      if (document.activeElement === document.body) focusFirstEnabledItem(menuRef.current)
    }
    document.addEventListener('pointerup', handlePointerUp, true)
    return () => document.removeEventListener('pointerup', handlePointerUp, true)
  }, [isOpen])

  // 開いたら最初の有効な項目へ移す。開いている間に Git の操作の状態が変わり、フォーカス中の項目が無効になったときも、
  // キーボードの行き場を失わないよう移す(有効な項目が無くなったら閉じる)。利用者が外へ移した先は奪わない
  useEffect(() => {
    if (!isOpen) return
    if (isButtonDisabled) {
      close()
      return
    }
    const active = document.activeElement
    const isFocusLost =
      active === null ||
      active === document.body ||
      active === buttonRef.current ||
      (active instanceof HTMLButtonElement &&
        active.disabled &&
        menuRef.current?.contains(active) === true)
    if (isFocusLost) focusFirstEnabledItem(menuRef.current)
  })

  const moveFocus = (key: string): void => {
    const enabledItems = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(ENABLED_ITEM_SELECTOR) ?? []
    )
    if (enabledItems.length === 0) return
    const lastIndex = enabledItems.length - 1
    const currentIndex = enabledItems.findIndex((item) => item === document.activeElement)
    const nextIndex: Record<string, number> = {
      ArrowDown: currentIndex === lastIndex ? 0 : currentIndex + 1,
      ArrowUp: currentIndex <= 0 ? lastIndex : currentIndex - 1,
      Home: 0,
      End: lastIndex
    }
    enabledItems[nextIndex[key]].focus()
  }

  const handleKeyDown = (event: React.KeyboardEvent): void => {
    // 長押しの Enter の続きで、開いたメニューの項目を実行したり、戻ったボタンで開き直したりしない
    if (event.key === 'Enter' && event.repeat) {
      event.preventDefault()
      return
    }
    if (!isOpen) return
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowUp':
      case 'Home':
      case 'End':
        event.preventDefault()
        moveFocus(event.key)
        break
      case 'Escape':
        event.preventDefault()
        close()
        break
      case 'Tab':
        // 既定の動きは止めない。項目は消えるため、先にボタンへ移して、Tab の移動の起点をボタンにする
        buttonRef.current?.focus()
        closeWithoutReturn()
        break
    }
  }

  return (
    <div className="action-menu" ref={rootRef} onKeyDown={handleKeyDown}>
      <button
        type="button"
        ref={buttonRef}
        className={buttonClassName}
        data-remote-setup-focus={focusTarget}
        disabled={isButtonDisabled}
        aria-label={buttonLabel}
        title={buttonLabel}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={isOpen ? close : open}
      >
        {buttonContent}
      </button>
      {isOpen && (
        <ul role="menu" aria-label={buttonLabel} className="action-menu__list" ref={menuRef}>
          {items.map((item) => (
            <li key={item.id} role="none">
              <button
                type="button"
                role={item.checked === undefined ? 'menuitem' : 'menuitemcheckbox'}
                aria-checked={item.checked}
                aria-label={item.ariaLabel}
                className="action-menu__item"
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => {
                  close()
                  item.onSelect()
                }}
              >
                {item.checked !== undefined && (
                  <span className="action-menu__check" aria-hidden="true">
                    {item.checked ? '✓' : ''}
                  </span>
                )}
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
