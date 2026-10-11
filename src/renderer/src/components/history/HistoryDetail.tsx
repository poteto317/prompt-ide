'use client'
import { useId } from 'react'
import type { HistoryEntry, HistoryEntryActions } from '../../types'
import MarkdownRenderer from '../output/MarkdownRenderer'
import { getHistoryToolLabel, formatExecutedAt } from '../../lib/historyFormatters'
import { AGENT_RESUME_ENTRY_LABEL } from '../../lib/agentSessionMessages'

interface Props {
  entry: HistoryEntry
  /** 再実行・このセッションで再開 の押せる条件と理由(useAgentWorkspace の getHistoryActions。省略できない。L-060) */
  actions: HistoryEntryActions
  onRerun: (entry: HistoryEntry) => void
  /** このセッションで再開(agent のあるエントリだけ。省略できない。L-060) */
  onResume: (entry: HistoryEntry) => void
  onDelete: (id: string) => void
}

export default function HistoryDetail({
  entry,
  actions,
  onRerun,
  onResume,
  onDelete
}: Props): React.JSX.Element {
  const toolLabel = getHistoryToolLabel(entry)
  // 2 つのボタンの理由は別の段落・別の id にする(L-057)
  const rerunReasonId = useId()
  const resumeReasonId = useId()
  const { rerun, resume } = actions
  const showRerunReason = rerun.disabled && rerun.reason !== null
  const showResumeReason = resume !== null && resume.disabled && resume.reason !== null

  return (
    <div className="history-detail">
      <div className="history-detail__header">
        <h3 className="history-detail__title">{entry.promptTitle}</h3>
        <div className="history-detail__meta">
          <span className="history-detail__tool">{toolLabel}</span>
          <span className="history-detail__time">{formatExecutedAt(entry.executedAt)}</span>
          {entry.agent !== null && (
            // 選んでコピーできる文字として出す(claude --resume で手動で開くときなど)
            <span className="history-detail__session">
              セッション: {entry.agent.claudeSessionId}
            </span>
          )}
        </div>
      </div>
      <div className="history-detail__actions">
        <button
          type="button"
          className="history-detail__rerun"
          onClick={() => onRerun(entry)}
          disabled={rerun.disabled}
          aria-describedby={showRerunReason ? rerunReasonId : undefined}
        >
          再実行
        </button>
        {resume !== null && (
          <button
            type="button"
            className="history-detail__resume"
            onClick={() => onResume(entry)}
            disabled={resume.disabled}
            aria-describedby={showResumeReason ? resumeReasonId : undefined}
          >
            {AGENT_RESUME_ENTRY_LABEL}
          </button>
        )}
        <button
          type="button"
          className="history-detail__delete"
          onClick={() => onDelete(entry.id)}
          aria-label="この履歴を削除"
        >
          削除
        </button>
      </div>
      {showRerunReason && (
        <p id={rerunReasonId} className="history-detail__rerun-reason">
          {rerun.reason}
        </p>
      )}
      {showResumeReason && (
        <p id={resumeReasonId} className="history-detail__resume-reason">
          {resume.reason}
        </p>
      )}
      <div className="history-detail__content">
        {entry.status === 'sent' && (
          // 結果の代わりに送った全文を読むだけで出す。長い本文は枠の中でスクロールし、Tab で止まってキーボードでもスクロールできる
          <pre className="history-detail__sent" role="region" aria-label="送った内容" tabIndex={0}>
            {entry.promptContent}
          </pre>
        )}
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
