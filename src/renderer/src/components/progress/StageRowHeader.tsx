'use client'
import type { Stage } from '../../types'
import type { StageDefinition } from '../../config/stageConfig'
import { statusIcon, statusLabel } from '../../lib/statusDisplay'

interface Props {
  stage: Stage
  definition: StageDefinition
  index: number
  expanded: boolean
  onToggle: () => void
}

export default function StageRowHeader({ stage, definition, index, expanded, onToggle }: Props) {
  const { kind, label } = definition
  const showBadge = kind !== 'once' && stage.events.length > 0

  return (
    <div className="stage-row__header">
      <span
        className="stage-row__icon"
        aria-label={statusLabel(stage.status)}
        title={statusLabel(stage.status)}
      >
        {statusIcon(stage.status)}
      </span>
      <span className="stage-row__name">
        {index + 1}. {label}
      </span>
      {kind === 'once' && <span className="stage-row__kind">(一度きり)</span>}
      {showBadge && (
        <span className="stage-row__badge" aria-label={`実施回数 ${stage.events.length} 回`}>
          ×{stage.events.length}
        </span>
      )}
      <button
        type="button"
        className="stage-row__toggle"
        aria-label={expanded ? '履歴を閉じる' : '履歴を開く'}
        aria-expanded={expanded}
        onClick={onToggle}
      >
        {expanded ? '∧' : 'v'}
      </button>
    </div>
  )
}
