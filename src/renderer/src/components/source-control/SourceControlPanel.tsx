import type { GitBranch, GitLogEntry, GitStatusResult } from '@shared/types'
import GitRepoView from './GitRepoView'

interface Props {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefresh: () => void
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
  onUnstage: (path: string) => void
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
  onLoadMoreLog: () => void
  operationError: Error | null
}

export default function SourceControlPanel({
  gitStatus,
  gitLoading,
  gitError,
  onRefresh,
  stagingPaths,
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
  onLoadMoreLog,
  operationError
}: Props): React.JSX.Element {
  return (
    <div className="source-control-panel">
      <div className="source-control-panel__toolbar">
        <button
          type="button"
          className="source-control-panel__refresh-btn"
          onClick={onRefresh}
          disabled={gitLoading}
          aria-label="更新"
        >
          更新
        </button>
      </div>
      {gitError && <p className="source-control-panel__error">{gitError.message}</p>}
      {operationError && <p className="source-control-panel__error">{operationError.message}</p>}
      {gitLoading && <p className="source-control-panel__loading">読み込み中...</p>}
      {gitStatus !== null &&
        !gitLoading &&
        (!gitStatus.isRepo ? (
          <p className="source-control-panel__no-repo">Git リポジトリではありません</p>
        ) : (
          <GitRepoView
            branch={gitStatus.branch}
            ahead={gitStatus.ahead}
            behind={gitStatus.behind}
            files={gitStatus.files}
            stagingPaths={stagingPaths}
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
            onLoadMoreLog={onLoadMoreLog}
          />
        ))}
      {gitStatus === null && !gitLoading && !gitError && (
        <p className="source-control-panel__placeholder">フォルダを開いてください</p>
      )}
    </div>
  )
}
