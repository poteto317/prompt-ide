'use client'
import type { HistoryEntry } from '../../types'
import MarkdownRenderer from '../output/MarkdownRenderer'
import { getToolLabel, formatExecutedAt } from '../../lib/historyFormatters'

interface Props {
  entry: HistoryEntry
  onRerun: (entry: HistoryEntry) => void
  onDelete: (id: string) => void
  isRerunDisabled: boolean
}

export default function HistoryDetail({ entry, onRerun, onDelete, isRerunDisabled }: Props) {
  const toolLabel = getToolLabel(entry.toolId)

  return (
    <div className="history-detail">
      <div className="history-detail__header">
        <h3 className="history-detail__title">{entry.promptTitle}</h3>
        <div className="history-detail__meta">
          <span className="history-detail__tool">{toolLabel}</span>
          <span className="history-detail__time">{formatExecutedAt(entry.executedAt)}</span>
        </div>
      </div>
      <div className="history-detail__actions">
        <button
          type="button"
          className="history-detail__rerun"
          onClick={() => onRerun(entry)}
          disabled={isRerunDisabled}
        >
          再実行
        </button>
        <button
          type="button"
          className="history-detail__delete"
          onClick={() => onDelete(entry.id)}
          aria-label="この履歴を削除"
        >
          削除
        </button>
      </div>
      <div className="history-detail__content">
        {entry.status === 'success' && entry.resultText !== null && (
          <MarkdownRenderer content={entry.resultText} />
        )}
        {entry.status === 'error' && entry.errorMessage !== null && (
          <p className="history-detail__error">{entry.errorMessage}</p>
        )}
      </div>
    </div>
  )
}
