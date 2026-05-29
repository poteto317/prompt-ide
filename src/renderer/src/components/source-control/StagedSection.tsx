import type { GitFileStatus } from '@shared/types'
import { statusChar } from '../../lib/gitUtils'

interface Props {
  files: GitFileStatus[]
}

export default function StagedSection({ files }: Props) {
  const staged = files.filter((f) => f.index !== ' ' && f.index !== '?')
  if (staged.length === 0) return null
  return (
    <section className="source-control-panel__section">
      <h3 className="source-control-panel__section-title">ステージ済み ({staged.length})</h3>
      <ul className="source-control-panel__file-list">
        {staged.map((f) => (
          <li key={f.path} className="source-control-panel__file-item">
            <span className="source-control-panel__file-status source-control-panel__file-status--staged">
              {statusChar(f.index)}
            </span>
            <span className="source-control-panel__file-path">{f.path}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}
