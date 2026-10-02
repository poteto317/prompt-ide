import { useRef } from 'react'
import type { GitBranch, GitLogEntry, GitStatusResult } from '@shared/types'
import GitRepoView from './GitRepoView'
import SourceControlToolbar from './SourceControlToolbar'
import NotRepositoryView from './NotRepositoryView'
import { getRemoteSetupState } from '../../lib/remoteSetupState'
import { useRemoteSetupFocus } from '../../hooks/useRemoteSetupFocus'
import { alwaysUnlocked } from '../../hooks/useFileOperationLock'
import type {
  BranchOperationKind,
  DiscardAllState,
  GitTagPanelState,
  MergeStatePanelState,
  RemoteSetupPanelState,
  StashPanelState
} from '../../types'

interface Props {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefresh: () => void
  stagingPaths: ReadonlySet<string>
  isLocked?: (path: string) => boolean
  isAnyLocked?: () => boolean
  onStage: (path: string) => void
  onDiscard: (path: string) => void
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
  pendingBranchOperation: BranchOperationKind | null
  onCheckoutBranch: (branchName: string) => Promise<void>
  onCreateBranch: (branchName: string) => Promise<boolean>
  onDeleteBranch: (branchName: string) => Promise<boolean>
  onMergeBranch: (branchName: string) => Promise<void>
  stash: StashPanelState
  discardAll: DiscardAllState
  mergeState: MergeStatePanelState
  gitTag: GitTagPanelState
  /** リモートの管理の状態と操作(Git 管理外の「リポジトリを初期化」、状態バナー、成功の後のフォーカスの移し先) */
  remoteSetup: RemoteSetupPanelState
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
  onDiscard,
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
  pendingBranchOperation,
  onCheckoutBranch,
  onCreateBranch,
  onDeleteBranch,
  onMergeBranch,
  stash,
  discardAll,
  mergeState,
  gitTag,
  remoteSetup,
  branchOperationError
}: Props): React.JSX.Element {
  // 初期化・追加・初回 push の成功の後に、次の操作のボタン(このパネルの中にある)へフォーカスを移す。
  // 要求する部品(NotRepositoryView・RemoteSetupBanner)へ requestFocus を渡す
  const rootRef = useRef<HTMLDivElement>(null)
  const { requestFocus: requestRemoteSetupFocus } = useRemoteSetupFocus(rootRef)
  return (
    <div className="source-control-panel" ref={rootRef}>
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
          <NotRepositoryView
            remoteSetup={remoteSetup}
            isBlocked={isAnyLocked()}
            requestFocus={requestRemoteSetupFocus}
          />
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
            onDiscard={onDiscard}
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
            pendingBranchOperation={pendingBranchOperation}
            onCheckoutBranch={onCheckoutBranch}
            onCreateBranch={onCreateBranch}
            onDeleteBranch={onDeleteBranch}
            onMergeBranch={onMergeBranch}
            stash={stash}
            discardAll={discardAll}
            mergeState={mergeState}
            gitTag={gitTag}
            remoteSetupKind={getRemoteSetupState(gitStatus)}
            remoteSetup={remoteSetup}
            requestRemoteSetupFocus={requestRemoteSetupFocus}
          />
        ))}
      {gitStatus === null && !gitLoading && !gitError && (
        <p className="source-control-panel__placeholder">フォルダを開いてください</p>
      )}
    </div>
  )
}
