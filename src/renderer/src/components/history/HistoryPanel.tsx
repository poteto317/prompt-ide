'use client'
import { useRef } from 'react'
import type { HistoryEntry } from '../../types'
import { useSelectedHistoryEntry } from '../../hooks/useSelectedHistoryEntry'
import HistoryItem from './HistoryItem'
import HistoryDetail from './HistoryDetail'

interface Props {
  history: HistoryEntry[]
  onDelete: (id: string) => void
  onClear: () => void
  onRerun: (entry: HistoryEntry) => void
  isRerunDisabled?: boolean
}

export default function HistoryPanel({
  history,
  onDelete,
  onClear,
  onRerun,
  isRerunDisabled = false
}: Props) {
  const { selectedEntry, selectEntry, deselectIfMatches } = useSelectedHistoryEntry(history)
  // id → ボタン要素の参照を保持する。DOM文字列セレクタでの検索を避けるため
  // （id は history.json 由来の永続データで任意の文字列になりうる）、
  // 各 HistoryItem がマウント時に自身の参照をここへ登録する。
  const itemRefs = useRef(new Map<string, HTMLButtonElement>())

  const registerItemRef = (id: string, el: HTMLButtonElement | null): void => {
    if (el) itemRefs.current.set(id, el)
    else itemRefs.current.delete(id)
  }

  const handleDelete = (id: string): void => {
    deselectIfMatches(id)
    onDelete(id)
  }

  // radiogroup の慣例に沿い、矢印キーで前後の履歴へ選択とフォーカスを移動する（roving tabindex）。
  // 対象のボタン要素は選択に関わらず常にマウントされているため、ハンドラ内で同期的に
  // focus() を呼べる（再レンダー後の副作用を挟まないため、フォーカス対象の取りこぼしが起きない）。
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const currentIndex = history.findIndex((entry) => entry.id === selectedEntry?.id)
    if (currentIndex === -1) return
    const delta = e.key === 'ArrowDown' ? 1 : -1
    const nextEntry = history[(currentIndex + delta + history.length) % history.length]
    selectEntry(nextEntry.id)
    itemRefs.current.get(nextEntry.id)?.focus()
  }

  return (
    <div className="history-panel">
      <div className="history-panel__toolbar">
        <button
          type="button"
          className="history-panel__clear"
          onClick={onClear}
          disabled={history.length === 0}
        >
          すべて削除
        </button>
      </div>
      <div className="history-panel__body">
        {history.length === 0 ? (
          <p className="history-panel__empty">履歴がありません</p>
        ) : (
          <>
            <div
              className="history-panel__list"
              role="radiogroup"
              aria-label="履歴一覧"
              onKeyDown={handleListKeyDown}
            >
              {history.map((entry) => (
                <HistoryItem
                  key={entry.id}
                  entry={entry}
                  isSelected={entry.id === selectedEntry?.id}
                  onSelect={() => selectEntry(entry.id)}
                  itemRef={(el) => registerItemRef(entry.id, el)}
                />
              ))}
            </div>
            {selectedEntry && (
              <HistoryDetail
                entry={selectedEntry}
                onRerun={onRerun}
                onDelete={handleDelete}
                isRerunDisabled={isRerunDisabled}
              />
            )}
          </>
        )}
      </div>
    </div>
  )
}
