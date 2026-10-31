import { useMemo, useRef } from 'react'
import type { CreateTagRequest, GitBranch, GitLogEntry } from '@shared/types'
import type { GitTagPanelState } from '../../types'
import { formatRelativeDate } from '../../lib/dateFormat'
import { buildGitGraphRows } from '../../lib/gitGraph'
import { useDialogFocusReturn } from '../../hooks/useDialogFocusReturn'
import CollapsibleSection from './CollapsibleSection'
import CreateTagDialog from './CreateTagDialog'
import GitGraphCell from './GitGraphCell'
import GitLogRefLabels from './GitLogRefLabels'

interface Props {
  log: GitLogEntry[]
  /** 現在のブランチの上流の短い名前(gitStatus.upstream)。グラフの上流のレーンの色に使う */
  upstream: string | null
  /** タグの作成の検証に使う(履歴には出さない) */
  branches: GitBranch[]
  /** タグの作成の検証に使う(タグはコミットの行のラベルに出す) */
  tags: string[]
  hasMore: boolean
  isLoading: boolean
  /** getLog が「コミット無し」以外の理由(git 未検出等)で失敗した場合のエラー */
  error: Error | null
  onLoadMore: () => void
  /** タグの作成の状態と操作(useGitTagOperations) */
  gitTag: GitTagPanelState
  /** 他の操作中(ステージ・ハンク操作・commit・pull・ブランチ操作・stash)で、作成しても no-op になる状態 */
  isBlocked: boolean
}

// entry.message は %B(コミット本文全体)由来で複数行を含み得るため、1 行目だけを件名として扱う
const getCommitSubject = (entry: GitLogEntry): string => entry.message.split('\n')[0]

const getShortHash = (entry: GitLogEntry): string => entry.hash.slice(0, 7)

const buildCommitTitle = (entry: GitLogEntry): string =>
  [
    getCommitSubject(entry),
    getShortHash(entry),
    entry.authorName,
    formatRelativeDate(entry.date)
  ].join('\n')

export default function HistorySection({
  log,
  upstream,
  branches,
  tags,
  hasMore,
  isLoading,
  error,
  onLoadMore,
  gitTag,
  isBlocked
}: Props): React.JSX.Element {
  const rows = useMemo(() => buildGitGraphRows(log, upstream), [log, upstream])

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
    <>
      <CollapsibleSection
        title="履歴"
        actions={
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
        }
        alwaysVisible={
          error !== null && (
            <p className="history-section__error" role="alert">
              {error.message}
            </p>
          )
        }
      >
        <ul className="history-section__log-list">
          {rows.map((row) => (
            <li
              key={row.entry.hash}
              className="history-section__log-item"
              title={buildCommitTitle(row.entry)}
            >
              <GitGraphCell row={row} />
              <span className="history-section__log-text">
                <span className="history-section__log-message">{getCommitSubject(row.entry)}</span>
                <span className="history-section__log-author">{row.entry.authorName}</span>
                {/* title は li に付くため、スクリーンリーダーとキーボードでは読めない */}
                <span className="history-section__visually-hidden">
                  {`${getShortHash(row.entry)} ${formatRelativeDate(row.entry.date)}`}
                </span>
              </span>
              <GitLogRefLabels refs={row.entry.refs} />
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
      </CollapsibleSection>
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
    </>
  )
}
