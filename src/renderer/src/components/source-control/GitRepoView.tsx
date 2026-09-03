import type { GitBranch, GitFileStatus, GitLogEntry } from '@shared/types'
import StagedSection from './StagedSection'
import ChangesSection from './ChangesSection'
import CommitSection from './CommitSection'
import HistorySection from './HistorySection'

interface Props {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
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
}

export default function GitRepoView({
  branch,
  ahead,
  behind,
  files,
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
  onLoadMoreLog
}: Props): React.JSX.Element {
  const stagedCount = files.filter((f) => f.index !== ' ' && f.index !== '?').length
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
      />
      <StagedSection
        files={files}
        stagingPaths={stagingPaths}
        onUnstage={onUnstage}
        onOpenDiff={(path) => onOpenDiff(path, true)}
      />
      <ChangesSection
        files={files}
        stagingPaths={stagingPaths}
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
        onLoadMore={onLoadMoreLog}
      />
    </>
  )
}
