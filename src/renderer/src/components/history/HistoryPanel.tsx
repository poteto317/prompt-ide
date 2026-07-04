'use client'
import { useEffect, useRef } from 'react'
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
  const listRef = useRef<HTMLDivElement>(null)
  // 矢印キーでの移動時のみフォーカスを追従させる（キーボード操作以外での選択変更で
  // フォーカスを奪わないよう、キーダウンハンドラ内で明示的にセットしたときだけ発火する）
  const pendingFocusIdRef = useRef<string | null>(null)

  useEffect(() => {
    const pendingId = pendingFocusIdRef.current
    if (pendingId === null) return
    pendingFocusIdRef.current = null
    // id は history.json（手動編集や破損の可能性がある永続データ）由来のため、
    // CSS.escape でエスケープしてから属性セレクタを組み立てる（未エスケープだと
    // " や ] を含む id で querySelector が SyntaxError を投げうる）
    listRef.current
      ?.querySelector<HTMLButtonElement>(`[data-entry-id="${CSS.escape(pendingId)}"]`)
      ?.focus()
  }, [selectedEntry?.id])

  const handleDelete = (id: string): void => {
    deselectIfMatches(id)
    onDelete(id)
  }

  // radiogroup の慣例に沿い、矢印キーで前後の履歴へ選択とフォーカスを移動する（roving tabindex）
  const handleListKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const currentIndex = history.findIndex((entry) => entry.id === selectedEntry?.id)
    if (currentIndex === -1) return
    const delta = e.key === 'ArrowDown' ? 1 : -1
    const nextEntry = history[(currentIndex + delta + history.length) % history.length]
    pendingFocusIdRef.current = nextEntry.id
    selectEntry(nextEntry.id)
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
              ref={listRef}
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
