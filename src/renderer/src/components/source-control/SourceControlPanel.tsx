import type { GitStatusResult } from '@shared/types'
import GitRepoView from './GitRepoView'

interface Props {
  gitStatus: GitStatusResult | null
  gitLoading: boolean
  gitError: Error | null
  onRefresh: () => void
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
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
  isCommitting,
  onCommit,
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
            isCommitting={isCommitting}
            onCommit={onCommit}
          />
        ))}
      {gitStatus === null && !gitLoading && !gitError && (
        <p className="source-control-panel__placeholder">フォルダを開いてください</p>
      )}
    </div>
  )
}
