import type { GitFileStatus } from '@shared/types'
import { statusChar } from '../../lib/gitUtils'

interface Props {
  files: GitFileStatus[]
}

export default function ChangesSection({ files }: Props) {
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
            <span className="source-control-panel__file-path">{f.path}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
