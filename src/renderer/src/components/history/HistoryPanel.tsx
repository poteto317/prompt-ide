'use client'
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

  const handleDelete = (id: string): void => {
    deselectIfMatches(id)
    onDelete(id)
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
            <div className="history-panel__list">
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
