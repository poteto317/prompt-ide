import type { GitBranch, GitLogEntry, GitStatusResult } from '@shared/types'
import GitRepoView from './GitRepoView'
import SourceControlToolbar from './SourceControlToolbar'
import { alwaysUnlocked } from '../../hooks/useFileOperationLock'

interface Props {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefresh: () => void
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
  isLoadingFolder: boolean
  historyError: Error | null
  onLoadMoreLog: () => void
  operationError: Error | null
  isPushing: boolean
  isPulling: boolean
  isFetching: boolean
  isPushBlocked: boolean
  isPullBlocked: boolean
  isRemoteOperationDisabled: boolean
  onPush: () => Promise<void>
  onPull: () => Promise<void>
  onFetch: () => Promise<void>
  remoteOperationError: Error | null
  isCheckingOut: boolean
  onCheckoutBranch: (branchName: string) => Promise<void>
  branchOperationError: Error | null
}

export default function SourceControlPanel({
  gitStatus,
  gitLoading,
  gitError,
  onRefresh,
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
  onLoadMoreLog,
  operationError,
  isPushing,
  isPulling,
  isFetching,
  isPushBlocked,
  isPullBlocked,
  isRemoteOperationDisabled,
  onPush,
  onPull,
  onFetch,
  remoteOperationError,
  isCheckingOut,
  onCheckoutBranch,
  branchOperationError
}: Props): React.JSX.Element {
  return (
    <div className="source-control-panel">
      <SourceControlToolbar
        gitLoading={gitLoading}
        onRefresh={onRefresh}
        isPushing={isPushing}
        isPulling={isPulling}
        isFetching={isFetching}
        isPushBlocked={isPushBlocked}
        isPullBlocked={isPullBlocked}
        isRemoteOperationDisabled={isRemoteOperationDisabled}
        onPush={onPush}
        onPull={onPull}
        onFetch={onFetch}
      />
      {gitError && <p className="source-control-panel__error">{gitError.message}</p>}
      {operationError && <p className="source-control-panel__error">{operationError.message}</p>}
      {remoteOperationError && (
        <p className="source-control-panel__error">{remoteOperationError.message}</p>
      )}
      {branchOperationError && (
        <p className="source-control-panel__error">{branchOperationError.message}</p>
      )}
      {/* 「読み込み中」を出すのは、まだ表示できる内容が何も無い初回取得のときだけ。
          再取得(stage/unstage/commit/ファイル保存のたびに走る)でも出してしまうと、
          下の GitRepoView がアンマウントされ、CommitSection のローカル state
          (入力中のコミットメッセージ・amend チェック)が破棄されてしまう */}
      {gitLoading && gitStatus === null && (
        <p className="source-control-panel__loading">読み込み中...</p>
      )}
      {gitStatus !== null &&
        (!gitStatus.isRepo ? (
          <p className="source-control-panel__no-repo">Git リポジトリではありません</p>
        ) : (
          <GitRepoView
            branch={gitStatus.branch}
            ahead={gitStatus.ahead}
            behind={gitStatus.behind}
            files={gitStatus.files}
            stagingPaths={stagingPaths}
            isLocked={isLocked}
            isAnyLocked={isAnyLocked}
            onStage={onStage}
            onUnstage={onUnstage}
            onOpenDiff={onOpenDiff}
            isCommitting={isCommitting}
            onCommit={onCommit}
            lastCommitMessage={lastCommitMessage}
            onAmend={onAmend}
            log={log}
            branches={branches}
            tags={tags}
            hasMoreLog={hasMoreLog}
            isLoadingLog={isLoadingLog}
            isLoadingFolder={isLoadingFolder}
            historyError={historyError}
            onLoadMoreLog={onLoadMoreLog}
            isCheckingOut={isCheckingOut}
            onCheckoutBranch={onCheckoutBranch}
          />
        ))}
      {gitStatus === null && !gitLoading && !gitError && (
        <p className="source-control-panel__placeholder">フォルダを開いてください</p>
      )}
    </div>
  )
}
