import type { GitFileStatus } from '@shared/types'
import { statusChar } from '../../lib/gitUtils'

interface Props {
  files: GitFileStatus[]
  stagingPaths: ReadonlySet<string>
  onStage: (path: string) => void
  onOpenDiff: (path: string) => void
}

export default function ChangesSection({
  files,
  stagingPaths,
  onStage,
  onOpenDiff
}: Props): React.JSX.Element | null {
  const changed = files.filter((f) => f.workingDir !== ' ' || f.index === '?')
  if (changed.length === 0) return null
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">変更 ({changed.length})</h3>
      <ul className="source-control-panel__file-list">
        {changed.map((f) => (
          <li key={f.path} className="source-control-panel__file-item">
            <span className="source-control-panel__file-status source-control-panel__file-status--changed">
              {f.index === '?' ? statusChar(f.index) : statusChar(f.workingDir)}
            </span>
            <button
              type="button"
              className="source-control-panel__file-path"
              onClick={() => onOpenDiff(f.path)}
              aria-label={`${f.path} の差分を表示`}
            >
              {f.path}
            </button>
            <button
              type="button"
              className="source-control-panel__stage-btn"
              onClick={() => onStage(f.path)}
              disabled={stagingPaths.has(f.path)}
              aria-label={`${f.path} をステージ`}
            >
              +
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
