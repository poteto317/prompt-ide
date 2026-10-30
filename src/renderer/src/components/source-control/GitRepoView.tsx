import type { GitBranch, GitFileStatus, GitLogEntry } from '@shared/types'
import StagedSection from './StagedSection'
import ChangesSection from './ChangesSection'
import CommitSection from './CommitSection'
import HistorySection from './HistorySection'
import StashSection from './StashSection'
import MergeBanner from './MergeBanner'
import RemoteSetupBanner from './RemoteSetupBanner'
import AgentChangesSection from './AgentChangesSection'
import type { AgentChangesPanelState } from '../../hooks/useAgentChangesWiring'
import { alwaysUnlocked } from '../../hooks/useFileOperationLock'
import type {
  DiscardAllState,
  GitTagPanelState,
  MergeStatePanelState,
  RemoteSetupPanelState,
  StashPanelState
} from '../../types'
import type { RemoteSetupFocusTarget, RemoteSetupKind } from '../../lib/remoteSetupState'
import { isStagedFile } from '../../lib/gitUtils'

export interface GitRepoViewProps {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
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
  isSyncing: boolean
  isSyncBlocked: boolean
  onSync: () => Promise<void>
  log: GitLogEntry[]
  /** 現在のブランチの上流の短い名前(gitStatus.upstream) */
  upstream: string | null
  branches: GitBranch[]
  tags: string[]
  hasMoreLog: boolean
  isLoadingLog: boolean
  /** フォルダ切替による履歴の初回取得中のみ true(同一フォルダ内の refresh では
   *  true にならない)。CommitSection の amend の選択/メッセージ欄リセットの
   *  トリガーに使う。isLoadingLog(HistorySection 用、refresh 中も true)とは別 */
  isLoadingFolder: boolean
  historyError: Error | null
  onLoadMoreLog: () => void
  stash: StashPanelState
  discardAll: DiscardAllState
  mergeState: MergeStatePanelState
  /** タグの作成の状態と操作(履歴セクションの「タグを作成」とダイアログ) */
  gitTag: GitTagPanelState
  /** リモートの状態バナーの種類(getRemoteSetupState(gitStatus)。SourceControlPanel が導出する) */
  remoteSetupKind: RemoteSetupKind | null
  /** リモートの管理の状態と操作(状態バナーの「リモートを追加」「初回 push」とダイアログ。Git 管理外の初期化にも使う) */
  remoteSetup: RemoteSetupPanelState
  /** 追加・初回 push の成功の後に、次の操作のボタンへのフォーカスを要求する(SourceControlPanel の useRemoteSetupFocus) */
  requestRemoteSetupFocus: (target: RemoteSetupFocusTarget) => void
  /** セクション「エージェントの変更」(バナーの直後・コミットの欄の上に置く)の状態と操作。Git 管理外かは SourceControlPanel が決める(ここでは常に Git 管理下) */
  agentChanges?: AgentChangesPanelState
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
  onDiscard,
  onUnstage,
  onOpenDiff,
  isCommitting,
  onCommit,
  lastCommitMessage,
  onAmend,
  isSyncing,
  isSyncBlocked,
  onSync,
  log,
  upstream,
  branches,
  tags,
  hasMoreLog,
  isLoadingLog,
  isLoadingFolder,
  historyError,
  onLoadMoreLog,
  stash,
  discardAll,
  mergeState,
  gitTag,
  remoteSetupKind,
  remoteSetup,
  requestRemoteSetupFocus,
  agentChanges
}: GitRepoViewProps): React.JSX.Element {
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
      <MergeBanner mergeState={mergeState} isBlocked={isBlockedByOtherOperation} />
      {/* マージのバナーの直後に出す(どちらも条件を満たせば両方。設計書の表) */}
      <RemoteSetupBanner
        kind={remoteSetupKind}
        branch={branch}
        remoteSetup={remoteSetup}
        requestFocus={requestRemoteSetupFocus}
        isBlocked={isBlockedByOtherOperation}
      />
      {/* エージェントの変更の確認 → ステージ → コミットが上から下に並ぶ(設計書「配置の案」A) */}
      {agentChanges !== undefined && (
        <AgentChangesSection {...agentChanges} isNotRepository={false} />
      )}
      <CommitSection
        stagedCount={stagedCount}
        isCommitting={isCommitting}
        onCommit={onCommit}
        lastCommitMessage={lastCommitMessage}
        onAmend={onAmend}
        isLoadingFolder={isLoadingFolder}
        isBlockedByOtherOperation={isBlockedByOtherOperation}
        ahead={ahead}
        behind={behind}
        mergeInProgress={mergeState.inProgress}
        isSyncing={isSyncing}
        isSyncBlocked={isSyncBlocked}
        onSync={onSync}
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
        onDiscard={onDiscard}
        onOpenDiff={(path) => onOpenDiff(path, false)}
        discardAll={discardAll}
      />
      <StashSection stash={stash} isBlocked={isBlockedByOtherOperation} />
      <HistorySection
        log={log}
        upstream={upstream}
        branches={branches}
        tags={tags}
        hasMore={hasMoreLog}
        isLoading={isLoadingLog}
        error={historyError}
        onLoadMore={onLoadMoreLog}
        gitTag={gitTag}
        isBlocked={isBlockedByOtherOperation}
      />
    </>
  )
}
