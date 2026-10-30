'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GitBranch } from '@shared/types'
import { useLatestRef } from '../../hooks/useLatestRef'
import {
  buildBranchPickerItems,
  initialBranchPickerSelection,
  moveBranchPickerSelection,
  resolveBranchPickerSelection
} from '../../lib/branchPicker'
import { isScrollbarMouseDown } from '../../lib/isScrollbarMouseDown'

interface Props {
  branches: GitBranch[]
  currentBranch: string | null
  /** 押せない状態(ブランチ操作の実行中・他の操作中)。確定を無視し、案内を出す */
  isDisabled: boolean
  onSelect: (branchName: string) => void
  onClose: () => void
}

const LISTBOX_ID = 'branch-picker-listbox'
const optionId = (index: number): string => `branch-picker-option-${index}`

// 親が開いている間だけマウントする。閉じたあとのフォーカスの復帰は親(useDialogFocusReturn)が担うため、
// ここでは戻さない。別のブランチの確定は onSelect だけを呼び、閉じるのと切り替えの順序は親が決める
export default function BranchQuickPick({
  branches,
  currentBranch,
  isDisabled,
  onSelect,
  onClose
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  // 添字ではなく名前で持つ。開いている間に一覧が変わっても同じブランチを指し続ける
  const [selected, setSelected] = useState(() =>
    initialBranchPickerSelection(buildBranchPickerItems(branches, currentBranch, ''))
  )

  const inputRef = useRef<HTMLInputElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  // オーバーレイ上で押し始めたクリックかどうか。入力欄からドラッグして
  // オーバーレイで離した場合、click は共通祖先のオーバーレイへ配送されるため、
  // mouseup の位置だけでは「外側のクリック」と区別できない
  const pressedOnOverlayRef = useRef(false)
  // この入力欄で Enter を押し始めたか。確定は離したときに行う(handleInputKeyUp)
  const enterPressedRef = useRef(false)
  const onCloseRef = useLatestRef(onClose)

  const items = useMemo(
    () => buildBranchPickerItems(branches, currentBranch, query),
    [branches, currentBranch, query]
  )
  const activeName = resolveBranchPickerSelection(items, selected)
  const activeIndex = items.findIndex((item) => item.name === activeName)

  useLayoutEffect(() => {
    inputRef.current?.focus()
  }, [])

  // キーボードで選択を動かしたとき、選択中の項目が一覧の外に出たままにならないようにする
  useEffect(() => {
    listRef.current?.children[activeIndex]?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, items])

  // Escape と Tab は document の capture で受ける。入力欄の onKeyDown だけに任せると、フォーカスが
  // ダイアログの外へ移った時点で閉じられなくなり、aria-modal のフォーカストラップも破れる
  // (QuickOpenDialog・useQuickOpen と同じ)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      // IME の変換中は横取りしない。変換候補の操作や変換の取り消しを奪うと日本語入力そのものが壊れる
      if (event.isComposing) return
      if (event.key === 'Escape') {
        event.preventDefault()
        // モーダルの Escape はここで消費する。伝播させると背後の document のハンドラまで反応してしまう
        event.stopPropagation()
        onCloseRef.current()
        return
      }
      if (event.key === 'Tab') {
        event.preventDefault()
        if (document.activeElement !== inputRef.current) inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown, true)
    return () => document.removeEventListener('keydown', handleKeyDown, true)
  }, [onCloseRef])

  const confirm = (name: string | null): void => {
    if (name === null || isDisabled) return
    if (name === currentBranch) {
      onClose()
      return
    }
    onSelect(name)
  }

  const handleQueryChange = (value: string): void => {
    setQuery(value)
    setSelected(buildBranchPickerItems(branches, currentBranch, value)[0]?.name ?? null)
  }

  const handleInputKeyDown = (e: React.KeyboardEvent): void => {
    // IME の変換中はキーを横取りしない。変換確定の Enter を確定として扱うと
    // 意図しないブランチへ切り替わり、↑↓ を奪うと変換候補を選べなくなる。前の Enter の keyup を取り逃して
    // 押し始めの印が残っていても、変換確定の keyup で確定しないよう消す
    if (e.nativeEvent.isComposing) {
      enterPressedRef.current = false
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setSelected(moveBranchPickerSelection(items, selected, 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setSelected(moveBranchPickerSelection(items, selected, -1))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      // 一覧を開いた Enter を押し続けたリピートは、この入力欄で押し始めたものとして扱わない
      if (!e.repeat) enterPressedRef.current = true
    }
  }

  // 確定は Enter を離したときに行う。押した時点で確定すると、未保存の確認(ネイティブのダイアログ)が開いた後も
  // 続くキーリピートが確認の既定のボタンを押し、未保存の編集を破棄してしまう
  const handleInputKeyUp = (e: React.KeyboardEvent): void => {
    if (e.key !== 'Enter' || !enterPressedRef.current) return
    enterPressedRef.current = false
    confirm(activeName)
  }

  // 入力欄以外を押したときにフォーカスが body へ移るのを防ぐ。移ってしまうと
  // 以降 ↑↓ / Enter が届かず、マウスでしか操作できなくなる。
  // ただしスクロールバーの操作は妨げず、離した時点でフォーカスを戻す
  const handleDialogMouseDown = (e: React.MouseEvent): void => {
    if (e.target === inputRef.current) return
    if (isScrollbarMouseDown(e)) return
    e.preventDefault()
  }

  const emptyMessage = query.trim() !== '' ? '一致するブランチがありません' : 'ブランチがありません'

  return (
    <div
      className="quick-open__overlay"
      role="presentation"
      data-testid="branch-picker-overlay"
      onMouseDown={(e) => {
        pressedOnOverlayRef.current = e.target === e.currentTarget
      }}
      // ダイアログ内の mouseup もここへ伝わる。スクロールバーのドラッグをダイアログ外で離した場合や、
      // オーバーレイを押して閉じなかった場合も、ここでフォーカスを戻す
      onMouseUp={() => {
        if (document.activeElement !== inputRef.current) inputRef.current?.focus()
      }}
      onClick={(e) => {
        // ボタンのダブルクリックの 2 回目が全画面のオーバーレイに落ちても、開いた直後に閉じない
        if (e.detail > 1) return
        if (pressedOnOverlayRef.current && e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="quick-open"
        role="dialog"
        aria-label="ブランチを切り替え"
        aria-modal="true"
        onMouseDown={handleDialogMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="quick-open__input"
          role="combobox"
          aria-label="ブランチ名で絞り込む"
          // popup(listbox)はダイアログ表示中つねに DOM にあるため、
          // 候補 0 件でも aria-expanded は true。件数ではなく開閉状態を表す属性
          aria-expanded
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          {...(activeIndex >= 0 ? { 'aria-activedescendant': optionId(activeIndex) } : {})}
          placeholder="切り替えるブランチを選択"
          value={query}
          onChange={(e) => handleQueryChange(e.target.value)}
          onKeyDown={handleInputKeyDown}
          onKeyUp={handleInputKeyUp}
          onBlur={() => {
            enterPressedRef.current = false
          }}
        />
        {isDisabled && (
          <p className="quick-open__empty" role="status">
            他の操作が完了するまで切り替えられません
          </p>
        )}
        <div
          id={LISTBOX_ID}
          role="listbox"
          aria-label="ブランチ"
          className="quick-open__list"
          ref={listRef}
        >
          {items.map((item, index) => (
            <div
              key={item.name}
              id={optionId(index)}
              role="option"
              aria-selected={item.name === activeName}
              className={`quick-open__item${item.name === activeName ? ' quick-open__item--active' : ''}`}
              onClick={() => confirm(item.name)}
              // mouseenter ではなく mousemove を使う。キーボードで選択を動かすと一覧が
              // スクロールし、静止したカーソルの下に別の項目が入って mouseenter が発火するため
              onMouseMove={() => setSelected(item.name)}
            >
              <span className="quick-open__name branch-picker__name" title={item.name}>
                {item.name}
              </span>
              {item.isCurrent && (
                <span className="quick-open__directory branch-picker__current">現在</span>
              )}
            </div>
          ))}
        </div>
        {items.length === 0 && (
          <p className="quick-open__empty" role="status">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  )
}
