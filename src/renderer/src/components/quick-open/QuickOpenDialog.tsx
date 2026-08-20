import { useEffect, useRef } from 'react'
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

  // キーボードで選択を動かしたとき、選択中の項目が一覧の外に出たままにならないようにする
  useEffect(() => {
    const list = listRef.current
    if (list === null) return
    const active = list.querySelector(`#${CSS.escape(optionId(activeIndex))}`)
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, results])

  if (!isOpen) return null

  const handleKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
      return
    }
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
    }
  }

  const emptyMessage = hasFolder
    ? '一致するファイルがありません'
    : 'フォルダが開かれていません。エクスプローラーからフォルダを開いてください'

  return (
    <div
      className="quick-open__overlay"
      role="presentation"
      data-testid="quick-open-overlay"
      onClick={close}
    >
      <div
        className="quick-open"
        role="dialog"
        aria-label="ファイルを開く"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          // 開いた直後に入力を始められるようにする(モーダルの慣例)
          autoFocus
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
