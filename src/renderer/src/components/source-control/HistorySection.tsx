import type { GitBranch, GitLogEntry } from '@shared/types'
import { formatRelativeDate } from '../../lib/dateFormat'

interface Props {
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMore: boolean
  isLoading: boolean
  /** getLog が「コミット無し」以外の理由(git 未検出等)で失敗した場合のエラー */
  error: Error | null
  onLoadMore: () => void
}

export default function HistorySection({
  log,
  branches,
  tags,
  hasMore,
  isLoading,
  error,
  onLoadMore
}: Props): React.JSX.Element {
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">履歴</h3>
      {error !== null && (
        <p className="history-section__error" role="alert">
          {error.message}
        </p>
      )}
      {(branches.length > 0 || tags.length > 0) && (
        <div className="history-section__badges">
          {branches.map((branch) => (
            <span
              key={branch.name}
              className={
                branch.current
                  ? 'history-section__badge history-section__badge--branch-current'
                  : 'history-section__badge history-section__badge--branch'
              }
            >
              {branch.name}
            </span>
          ))}
          {tags.map((tag) => (
            <span key={tag} className="history-section__badge history-section__badge--tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      <ul className="history-section__log-list">
        {log.map((entry) => (
          <li key={entry.hash} className="history-section__log-item">
            <span className="history-section__log-hash">{entry.hash.slice(0, 7)}</span>
            {/* entry.message は %B（コミット本文全体）由来で複数行を含み得るため、
                一覧には subject に相当する最初の行だけを表示する */}
            <span className="history-section__log-message">{entry.message.split('\n')[0]}</span>
            <span className="history-section__log-date">{formatRelativeDate(entry.date)}</span>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          className="history-section__load-more-btn"
          onClick={onLoadMore}
          disabled={isLoading}
        >
          もっと見る
        </button>
      )}
    </section>
  )
}
