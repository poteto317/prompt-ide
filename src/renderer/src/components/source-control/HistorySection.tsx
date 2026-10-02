import { useEffect, useRef, useState } from 'react'
import type { CreateTagRequest, GitBranch, GitLogEntry } from '@shared/types'
import type { GitTagPanelState } from '../../types'
import { formatRelativeDate } from '../../lib/dateFormat'
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
  const [isTagDialogOpen, setIsTagDialogOpen] = useState(false)
  const createTagButtonRef = useRef<HTMLButtonElement>(null)

  // 開くときに前回の失敗の表示を消す(キャンセルしたダイアログのエラーを持ち越さない)
  const openTagDialog = (): void => {
    gitTag.clearError()
    setIsTagDialogOpen(true)
  }

  // ダイアログを閉じたら(成功・キャンセル・Escape・オーバーレイのクリック)ボタンへフォーカスを戻す
  // (パターン 22)。閉じる時点で直接 focus() すると、成功の経路では作成中フラグの解除(setBusy(false))が
  // まだ再描画に反映されておらず、disabled のボタンへの focus() が無視されてフォーカスが body に落ちる
  // (パターン 73)。そのため閉じるときは「戻す予約」だけを立て、ダイアログが閉じて作成中でもなくなった
  // 描画の後(下の useEffect)で戻す。予約は閉じたダイアログに対してだけ立つため、アンマウントで消え、
  // フォルダの切り替え等で別のボタンへ持ち越さない
  const restoreFocusPendingRef = useRef(false)
  const closeTagDialog = (): void => {
    restoreFocusPendingRef.current = true
    setIsTagDialogOpen(false)
  }

  // gitTag.isCreating の判定は保険(createTag は setBusy(false) の後に解決するため、閉じる描画では
  // 既に作成中が解けている)。createTag・clearError は毎回変わる参照のため依存に入れない
  useEffect(() => {
    if (!restoreFocusPendingRef.current || isTagDialogOpen || gitTag.isCreating) return
    restoreFocusPendingRef.current = false
    // フォーカスが行き場を失っている(閉じたダイアログの中にあって body に落ちた)ときだけ戻す。
    // 作成中にユーザーがダイアログの外の要素へ移していたら、遅れて届いた成功で奪わない
    const active = document.activeElement
    if (active === null || active === document.body) createTagButtonRef.current?.focus()
  }, [isTagDialogOpen, gitTag.isCreating])

  // 成功したときだけ閉じる。失敗(false)はダイアログ内に gitTag.error を表示したまま残す
  const handleCreateTag = async (request: CreateTagRequest): Promise<void> => {
    if (await gitTag.createTag(request)) closeTagDialog()
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
          onClick={openTagDialog}
        >
          タグを作成
        </button>
      </div>
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
      {isTagDialogOpen && (
        <CreateTagDialog
          tags={tags}
          branchNames={branches.map((branch) => branch.name)}
          isCreating={gitTag.isCreating}
          isBlocked={isBlocked}
          error={gitTag.error}
          onSubmit={(request) => void handleCreateTag(request)}
          onCancel={closeTagDialog}
        />
      )}
    </section>
  )
}
