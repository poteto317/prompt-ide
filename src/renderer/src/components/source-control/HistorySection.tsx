import { useRef } from 'react'
import type { CreateTagRequest, GitBranch, GitLogEntry } from '@shared/types'
import type { GitTagPanelState } from '../../types'
import { formatRelativeDate } from '../../lib/dateFormat'
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
import CreateTagDialog from './CreateTagDialog'

interface Props {
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMore: boolean
  isLoading: boolean
  /** getLog が「コミット無し」以外の理由(git 未検出等)で失敗した場合のエラー */
  error: Error | null
  onLoadMore: () => void
  /** タグの作成の状態と操作(useGitTagOperations) */
  gitTag: GitTagPanelState
  /** 他の操作中(ステージ・ハンク操作・commit・pull・ブランチ操作・退避)で、作成しても no-op になる状態 */
  isBlocked: boolean
}

export default function HistorySection({
  log,
  branches,
  tags,
  hasMore,
  isLoading,
  error,
  onLoadMore,
  gitTag,
  isBlocked
}: Props): React.JSX.Element {
  // 開くときに前回の失敗の表示を消す(キャンセルしたダイアログのエラーを持ち越さない)。ダイアログを閉じたら
  // (成功・キャンセル・Escape・オーバーレイのクリック)ボタンへフォーカスを戻す(パターン 22)。戻すのは閉じて
  // 作成中でもなくなった描画の後で、フォーカスが body のときだけ(useDialogFocusReturn。パターン 73・86)。
  // isRunning の判定は保険(createTag は setBusy(false) の後に解決するため、閉じる描画では既に作成中が解けている)
  const createTagButtonRef = useRef<HTMLButtonElement>(null)
  const tagDialog = useDialogFocusReturn({
    isRunning: gitTag.isCreating,
    onOpen: gitTag.clearError,
    openerRef: createTagButtonRef
  })

  // 成功したときだけ閉じ、ボタンへ戻す(次の操作のボタンへ移す先が無いため)。失敗(false)はダイアログ内に
  // gitTag.error を表示したまま残す
  const handleCreateTag = async (request: CreateTagRequest): Promise<void> => {
    if (await gitTag.createTag(request)) tagDialog.close()
  }

  return (
    <section className="source-control-panel__section">
      <div className="history-section__header">
        <h3 className="source-control-panel__section-title">履歴</h3>
        <button
          ref={createTagButtonRef}
          type="button"
          className="history-section__create-tag"
          aria-label="タグを作成"
          // 作成中も押せない(開き直したダイアログが、前の作成の成功で閉じられるのを防ぐ。パターン 73)
          disabled={isBlocked || gitTag.isCreating}
          onClick={tagDialog.open}
        >
          タグを作成
        </button>
      </div>
      {error !== null && (
        <p className="history-section__error" role="alert">
          {error.message}
        </p>
      )}
      {tags.length > 0 && (
        <div className="history-section__badges">
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
      {tagDialog.isOpen && (
        <CreateTagDialog
          tags={tags}
          branchNames={branches.map((branch) => branch.name)}
          isCreating={gitTag.isCreating}
          isBlocked={isBlocked}
          error={gitTag.error}
          onSubmit={(request) => void handleCreateTag(request)}
          onCancel={tagDialog.close}
        />
      )}
    </section>
  )
}
