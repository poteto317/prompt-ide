'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GitBranch } from '@shared/types'
import { useLatestRef } from '../../hooks/useLatestRef'
import {
  BRANCH_PICKER_ARIA_KEYSHORTCUTS,
  CREATE_BRANCH_OPTION,
  buildBranchPickerItems,
  getBranchPickerShortcut,
  initialBranchPickerSelection,
  moveBranchPickerSelection,
  resolveBranchPickerSelection,
  withCreateBranchOption
} from '../../lib/branchPicker'
import type { BranchPickerShortcut } from '../../lib/branchPicker'
import { isScrollbarMouseDown } from '../../lib/isScrollbarMouseDown'

interface Props {
  branches: GitBranch[]
  currentBranch: string | null
  /** 押せない状態(ブランチ操作の実行中・他の操作中)。確定を無視し、案内を出す */
  isDisabled: boolean
  onSelect: (branchName: string) => void
  /** 「＋ 新しいブランチを作成…」の確定。絞り込みの文字(前後の空白を除く)を渡す。一覧を閉じてダイアログを開くのは親の役割 */
  onCreateRequest: (initialName: string) => void
  /** マージのボタン、または Alt+M。確認は呼び出し元(フック)が出す */
  onMerge: (branchName: string) => void
  /** 削除のボタン、または Shift+Delete。確認は呼び出し元(フック)が出す */
  onDelete: (branchName: string) => void
  onClose: () => void
}

const LISTBOX_ID = 'branch-picker-listbox'
const optionId = (index: number): string => `branch-picker-option-${index}`

interface RowActionButtonProps {
  label: string
  ariaLabel: string
  className: string
  isDisabled: boolean
  onPress: () => void
}

// 行のマージ・削除のボタン。Tab の停止点にせず、フォーカスは入力欄に残す(キーボードでは Alt+M・Shift+Delete)。
// 押せない状態は disabled にしない。disabled だと mousedown が届かず入力欄のフォーカスを失うため、
// aria-disabled にして押下を受け、行の確定へ伝えないようにする
function RowActionButton({
  label,
  ariaLabel,
  className,
  isDisabled,
  onPress
}: RowActionButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      tabIndex={-1}
      className={className}
      aria-label={ariaLabel}
      aria-disabled={isDisabled}
      onClick={(e) => {
        e.stopPropagation()
        onPress()
      }}
    >
      {label}
    </button>
  )
}

// 親が開いている間だけマウントする。閉じたあとのフォーカスの復帰は親(useDialogFocusReturn)が担うため、
// ここでは戻さない。別のブランチの確定・作成・マージ・削除は親の関数だけを呼び、閉じるのと操作の順序は親が決める
export default function BranchQuickPick({
  branches,
  currentBranch,
  isDisabled,
  onSelect,
  onCreateRequest,
  onMerge,
  onDelete,
  onClose
}: Props): React.JSX.Element {
  const [query, setQuery] = useState('')
  // 添字ではなく名前で持つ。開いている間に一覧が変わっても同じブランチを指し続ける。作成の項目は
  // CREATE_BRANCH_OPTION で表す。開いたときの選択はブランチの候補だけで決める(作成の項目を選んだ状態で開かない)
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

  const branchItems = useMemo(
    () => buildBranchPickerItems(branches, currentBranch, query),
    [branches, currentBranch, query]
  )
  const items = useMemo(() => withCreateBranchOption(branchItems), [branchItems])
  const activeName = resolveBranchPickerSelection(items, selected)
  const activeIndex = items.findIndex((item) => item.name === activeName)

  useLayoutEffect(() => {
    inputRef.current?.focus()
  }, [])

  // キーボードで選択を動かしたとき、選択中の項目が一覧の外に出たままにならないようにする
  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' })
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
    if (name === CREATE_BRANCH_OPTION) {
      onCreateRequest(query.trim())
      return
    }
    if (name === currentBranch) {
      onClose()
      return
    }
    onSelect(name)
  }

  // 現在のブランチと作成の項目は、マージも削除もできない
  const runRowAction = (action: BranchPickerShortcut, name: string | null): void => {
    if (name === null || isDisabled) return
    if (name === CREATE_BRANCH_OPTION || name === currentBranch) return
    if (action === 'merge') onMerge(name)
    else onDelete(name)
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
    // 判定に当たったキーは、何もしない場合も必ず既定の動作を止める。絞り込みの文字の入力・削除に漏らさない。
    // リピートは実行しない(確認がネイティブのダイアログのため、押し続けたキーの続きで開かない)
    const shortcut = getBranchPickerShortcut(e)
    if (shortcut !== null) {
      e.preventDefault()
      if (!e.repeat) runRowAction(shortcut, activeName)
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
          aria-keyshortcuts={BRANCH_PICKER_ARIA_KEYSHORTCUTS}
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
          {items.map((item, index) => {
            const isCreate = item.name === CREATE_BRANCH_OPTION
            const isActive = item.name === activeName
            const hasActions = !isCreate && !item.isCurrent
            return (
              // 行のボタンは option の外に置く。option の子はアクセシブルネームに混ざり、読み上げから隠れる。
              // クリックとマウスの追従は、ボタンの上でも効くよう行で受ける
              <div
                key={item.name}
                role="presentation"
                className={`branch-picker__row${isCreate ? ' branch-picker__row--create' : ''}${hasActions ? ' branch-picker__row--actions' : ''}`}
                onClick={() => confirm(item.name)}
                // mouseenter ではなく mousemove を使う。キーボードで選択を動かすと一覧が
                // スクロールし、静止したカーソルの下に別の項目が入って mouseenter が発火するため
                onMouseMove={() => setSelected(item.name)}
              >
                <div
                  id={optionId(index)}
                  role="option"
                  aria-selected={isActive}
                  className={`quick-open__item${isActive ? ' quick-open__item--active' : ''}`}
                >
                  {isCreate ? (
                    <span className="quick-open__name">＋ 新しいブランチを作成…</span>
                  ) : (
                    <span className="quick-open__name branch-picker__name" title={item.name}>
                      {item.name}
                    </span>
                  )}
                  {item.isCurrent && (
                    <span className="quick-open__directory branch-picker__current">現在</span>
                  )}
                </div>
                {hasActions && (
                  // ボタンの隙間の click を行の確定へ伝えない(押せない状態のボタンと同じ扱いにする)
                  <div className="branch-picker__actions" onClick={(e) => e.stopPropagation()}>
                    <RowActionButton
                      label="マージ"
                      ariaLabel={`ブランチ ${item.name} を現在のブランチにマージ`}
                      className="branch-picker__action branch-picker__action--merge"
                      isDisabled={isDisabled}
                      onPress={() => runRowAction('merge', item.name)}
                    />
                    <RowActionButton
                      label="削除"
                      ariaLabel={`ブランチ ${item.name} を削除`}
                      className="branch-picker__action branch-picker__action--delete"
                      isDisabled={isDisabled}
                      onPress={() => runRowAction('delete', item.name)}
                    />
                  </div>
                )}
              </div>
            )
          })}
        </div>
        {branchItems.length === 0 && (
          <p className="quick-open__empty" role="status">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  )
}
