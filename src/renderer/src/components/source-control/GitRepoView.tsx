import type { GitBranch, GitFileStatus, GitLogEntry } from '@shared/types'
import StagedSection from './StagedSection'
import ChangesSection from './ChangesSection'
import CommitSection from './CommitSection'
import HistorySection from './HistorySection'
import { alwaysUnlocked } from '../../hooks/useFileOperationLock'
import { isStagedFile } from '../../lib/gitUtils'

interface Props {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  stagingPaths: ReadonlySet<string>
  isLocked?: (path: string) => boolean
  isAnyLocked?: () => boolean
  onStage: (path: string) => void
  onUnstage: (path: string, renamedFrom?: string) => void
  onOpenDiff: (path: string, staged: boolean) => void
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
  lastCommitMessage: string | null
  onAmend: (message: string) => Promise<boolean>
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMoreLog: boolean
  isLoadingLog: boolean
  /** フォルダ切替による履歴の初回取得中のみ true(同一フォルダ内の refresh では
   *  true にならない)。CommitSection の amend チェック/メッセージ欄リセットの
   *  トリガーに使う。isLoadingLog(HistorySection 用、refresh 中も true)とは別 */
  isLoadingFolder: boolean
  historyError: Error | null
  onLoadMoreLog: () => void
}

export default function GitRepoView({
  branch,
  ahead,
  behind,
  files,
  stagingPaths,
  isLocked = alwaysUnlocked,
  isAnyLocked = alwaysUnlocked,
  onStage,
  onUnstage,
  onOpenDiff,
  isCommitting,
  onCommit,
  lastCommitMessage,
  onAmend,
  log,
  branches,
  tags,
  hasMoreLog,
  isLoadingLog,
  isLoadingFolder,
  historyError,
  onLoadMoreLog
}: Props): React.JSX.Element {
  const stagedCount = files.filter(isStagedFile).length
  // stage/unstage(useGitOperations)実行中、ハンク操作(useDiffOperations の
  // git apply --cached)実行中、または pull(useGitRemoteOperations が working
  // tree/index を書き換える間 lockGlobal で isAnyLocked() を true にする)実行中は、
  // runCommitOperation が .git/index の競合を避けてサイレントに no-op する
  // (useGitOperations.ts 参照)。ボタン側でも揃えないと、押しても何も起きない
  // 状態に見えてしまう
  const isBlockedByOtherOperation = stagingPaths.size > 0 || isAnyLocked()
  return (
    <>
      <div className="source-control-panel__branch">
        <span>{branch ?? '(no branch)'}</span>
        {ahead > 0 && <span className="source-control-panel__ahead">↑{ahead}</span>}
        {behind > 0 && <span className="source-control-panel__behind">↓{behind}</span>}
      </div>
      <CommitSection
        stagedCount={stagedCount}
        isCommitting={isCommitting}
        onCommit={onCommit}
        lastCommitMessage={lastCommitMessage}
        onAmend={onAmend}
        isLoadingFolder={isLoadingFolder}
        isBlockedByOtherOperation={isBlockedByOtherOperation}
      />
      <StagedSection
        files={files}
        stagingPaths={stagingPaths}
        isLocked={isLocked}
        isAnyLocked={isAnyLocked}
        onUnstage={onUnstage}
        onOpenDiff={(path) => onOpenDiff(path, true)}
      />
      <ChangesSection
        files={files}
        stagingPaths={stagingPaths}
        isLocked={isLocked}
        isAnyLocked={isAnyLocked}
        onStage={onStage}
        onOpenDiff={(path) => onOpenDiff(path, false)}
      />
      {files.length === 0 && <p className="source-control-panel__empty">変更はありません</p>}
      <HistorySection
        log={log}
        branches={branches}
        tags={tags}
        hasMore={hasMoreLog}
        isLoading={isLoadingLog}
        error={historyError}
        onLoadMore={onLoadMoreLog}
      />
    </>
  )
}
