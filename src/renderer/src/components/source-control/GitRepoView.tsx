import type { GitFileStatus } from '@shared/types'
import StagedSection from './StagedSection'
import ChangesSection from './ChangesSection'
import CommitSection from './CommitSection'

interface Props {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
  onUnstage: (path: string) => void
  isCommitting: boolean
  onCommit: (message: string) => Promise<boolean>
}

export default function GitRepoView({
  branch,
  ahead,
  behind,
  files,
  stagingPaths,
  onStage,
  onUnstage,
  isCommitting,
  onCommit
}: Props): React.JSX.Element {
  const stagedCount = files.filter((f) => f.index !== ' ' && f.index !== '?').length
  return (
    <>
      <div className="source-control-panel__branch">
        <span>{branch ?? '(no branch)'}</span>
        {ahead > 0 && <span className="source-control-panel__ahead">↑{ahead}</span>}
        {behind > 0 && <span className="source-control-panel__behind">↓{behind}</span>}
      </div>
      <CommitSection stagedCount={stagedCount} isCommitting={isCommitting} onCommit={onCommit} />
      <StagedSection files={files} stagingPaths={stagingPaths} onUnstage={onUnstage} />
      <ChangesSection files={files} stagingPaths={stagingPaths} onStage={onStage} />
      {files.length === 0 && <p className="source-control-panel__empty">変更はありません</p>}
    </>
  )
}
