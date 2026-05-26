import type { GitFileStatus } from '@shared/types'
import StagedSection from './StagedSection'
import ChangesSection from './ChangesSection'

interface Props {
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
}

export default function GitRepoView({ branch, ahead, behind, files }: Props) {
  return (
    <>
      <div className="source-control-panel__branch">
        <span>{branch ?? '(no branch)'}</span>
        {ahead > 0 && <span className="source-control-panel__ahead">↑{ahead}</span>}
        {behind > 0 && <span className="source-control-panel__behind">↓{behind}</span>}
      </div>
      <StagedSection files={files} />
      <ChangesSection files={files} />
      {files.length === 0 && (
        <p className="source-control-panel__empty">変更はありません</p>
      )}
    </>
  )
}
