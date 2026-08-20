import { useEffect, useLayoutEffect, useRef } from 'react'
import type { QuickOpenController } from '../../hooks/useQuickOpen'
import QuickOpenItem from './QuickOpenItem'

interface Props {
  controller: QuickOpenController
}

const LISTBOX_ID = 'quick-open-listbox'
const optionId = (index: number): string => `quick-open-option-${index}`

export default function QuickOpenDialog({ controller }: Props): React.JSX.Element | null {
  const {
    isOpen,
    query,
    results,
    activeIndex,
    hasFolder,
    close,
    setQuery,
    moveSelection,
    setActiveIndex,
    confirm
  } = controller

  const listRef = useRef<HTMLDivElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  // オーバーレイ上で押し始めたクリックかどうか。入力欄からドラッグして
  // オーバーレイで離した場合、click は共通祖先のオーバーレイへ配送されるため、
  // mouseup の位置だけでは「外側のクリック」と区別できない
  const pressedOnOverlayRef = useRef(false)

  // autoFocus 属性ではなくここで明示的にフォーカスする。autoFocus は
  // コミット時に適用されるため、effect の時点では document.activeElement が
  // 既に入力欄になっており、開く前の要素を控えられない
  useLayoutEffect(() => {
    if (!isOpen) return
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    inputRef.current?.focus()
    // 閉じたら元の要素へフォーカスを戻す。戻さないと body に取り残され、
    // Escape のあとエディタへ直接タイプできなくなる
    return () => previouslyFocused?.focus()
  }, [isOpen])

  // キーボードで選択を動かしたとき、選択中の項目が一覧の外に出たままにならないようにする
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const active = list.querySelector(`#${CSS.escape(optionId(activeIndex))}`)
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  if (!isOpen) return null

  // Escape は useQuickOpen が document で購読するためここでは扱わない
  // (フォーカスがダイアログ外にあっても閉じられるようにするため)
  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      moveSelection(1)
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      moveSelection(-1)
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      confirm()
      return
    }
    // aria-modal を宣言している以上、フォーカスはダイアログ内に留める。
    // フォーカス可能な要素は入力欄だけなので、Tab を止めれば外へ抜けない
    if (e.key === 'Tab') e.preventDefault()
  }

  // 入力欄以外を押したときにフォーカスが body へ移るのを防ぐ。移ってしまうと
  // 以降 ↑↓ / Enter / Escape が届かず、マウスでしか操作できなくなる
  const handleDialogMouseDown = (e: React.MouseEvent): void => {
    if (e.target !== inputRef.current) e.preventDefault()
  }

  const emptyMessage = hasFolder
    ? '一致するファイルがありません'
    : 'フォルダが開かれていません。エクスプローラーからフォルダを開いてください'

  return (
    <div
      className="quick-open__overlay"
      role="presentation"
      data-testid="quick-open-overlay"
      onMouseDown={(e) => {
        pressedOnOverlayRef.current = e.target === e.currentTarget
      }}
      onClick={(e) => {
        if (pressedOnOverlayRef.current && e.target === e.currentTarget) close()
      }}
    >
      <div
        className="quick-open"
        role="dialog"
        aria-label="ファイルを開く"
        aria-modal="true"
        onMouseDown={handleDialogMouseDown}
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          type="text"
          className="quick-open__input"
          role="combobox"
          aria-label="ファイル名で検索"
          aria-expanded={results.length > 0}
          aria-controls={LISTBOX_ID}
          aria-autocomplete="list"
          {...(results.length > 0 ? { 'aria-activedescendant': optionId(activeIndex) } : {})}
          placeholder="ファイル名を入力"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        <div
          id={LISTBOX_ID}
          role="listbox"
          aria-label="検索結果"
          className="quick-open__list"
          ref={listRef}
        >
          {results.map((result, index) => (
            <QuickOpenItem
              key={result.node.path}
              id={optionId(index)}
              result={result}
              isActive={index === activeIndex}
              onSelect={() => confirm(index)}
              onHover={() => setActiveIndex(index)}
            />
          ))}
        </div>
        {results.length === 0 && (
          <p className="quick-open__empty" role="status">
            {emptyMessage}
          </p>
        )}
      </div>
    </div>
  )
}
