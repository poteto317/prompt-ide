import type { GitStashEntry } from '@shared/types'
import type { PendingStashOperation } from '../../types'
import { formatRelativeDate } from '../../lib/dateFormat'
import { getStashDisplayName } from '../../lib/stashDisplayName'

interface Props {
  entry: GitStashEntry
  /** 実行中の stash 操作(どの stash に対するものかは pending.sha で分かる) */
  pending: PendingStashOperation | null
  /** 他の操作中(ステージ・コミット・pull・ブランチ操作 等)で押しても no-op になる状態 */
  isBlocked: boolean
  onPop: (sha: string) => void
  onDrop: (entry: GitStashEntry) => void
}

// stash 一覧の 1 行(メッセージ・ブランチ・日時と、戻す・捨てるボタン)。
// 押したボタンだけを実行中の表示にし、別の行の同じボタンは通常の表示のまま disabled だけにする
export default function StashItem({
  entry,
  pending,
  isBlocked,
  onPop,
  onDrop
}: Props): React.JSX.Element {
  const name = getStashDisplayName(entry.message)
  const isDisabled = isBlocked || pending !== null
  const isPopping = pending?.kind === 'pop' && pending.sha === entry.sha
  const isDropping = pending?.kind === 'drop' && pending.sha === entry.sha
  return (
    <li className="stash-section__item">
      <div className="stash-section__summary">
        <span className="stash-section__message">{name}</span>
        <span className="stash-section__meta">
          {entry.branch !== '' && <span className="stash-section__branch">{entry.branch}</span>}
          <span className="stash-section__date">{formatRelativeDate(entry.createdAt)}</span>
        </span>
      </div>
      <button
        type="button"
        className="stash-section__action"
        aria-label={isPopping ? 'stash を戻し中' : `stash ${name} を戻す`}
        disabled={isDisabled}
        onClick={() => onPop(entry.sha)}
      >
        {isPopping ? '戻し中...' : '戻す'}
      </button>
      <button
        type="button"
        className="stash-section__action stash-section__action--danger"
        aria-label={isDropping ? 'stash を削除中' : `stash ${name} を捨てる`}
        disabled={isDisabled}
        onClick={() => onDrop(entry)}
      >
        {isDropping ? '削除中...' : '捨てる'}
      </button>
    </li>
  )
}
