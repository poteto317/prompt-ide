'use client'
import type { HistoryEntry } from '../../types'
import { truncatePreview } from '../../lib/promptUtils'
import {
  getHistoryToolLabel,
  getHistoryPreviewSource,
  formatExecutedAt,
  getStatusLabel
} from '../../lib/historyFormatters'

interface Props {
  entry: HistoryEntry
  isSelected: boolean
  onSelect: () => void
  itemRef?: (el: HTMLButtonElement | null) => void
}

export default function HistoryItem({
  entry,
  isSelected,
  onSelect,
  itemRef
}: Props): React.JSX.Element {
  const toolLabel = getHistoryToolLabel(entry)
  const statusLabel = getStatusLabel(entry.status)
  const preview = truncatePreview(getHistoryPreviewSource(entry))

  return (
    <button
      ref={itemRef}
      type="button"
      className={`history-item${isSelected ? ' history-item--selected' : ''}`}
      onClick={onSelect}
      role="radio"
      aria-checked={isSelected}
      tabIndex={isSelected ? 0 : -1}
    >
      <div className="history-item__header">
        <span className="history-item__title">{entry.promptTitle}</span>
        <span
          className={`history-item__status history-item__status--${entry.status}`}
          aria-label={statusLabel}
        >
          {statusLabel}
        </span>
      </div>
      <div className="history-item__meta">
        <span className="history-item__tool">{toolLabel}</span>
        <span className="history-item__time">{formatExecutedAt(entry.executedAt)}</span>
      </div>
      <div className="history-item__preview">{preview}</div>
    </button>
  )
}
