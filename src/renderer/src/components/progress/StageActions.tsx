'use client'
import type { Stage, StageKind } from '../../types'
import { stageActionList, type StageActionType } from '../../lib/stageActions'

interface Props {
  stage: Stage
  kind: StageKind
  isCurrent: boolean
  isLast: boolean
  onComplete: () => void
  onReopen: () => void
  onSkip: () => void
  onAdvance: () => void
}

export default function StageActions({
  stage,
  kind,
  isCurrent,
  isLast,
  onComplete,
  onReopen,
  onSkip,
  onAdvance
}: Props) {
  const handlers: Record<StageActionType, () => void> = {
    complete: onComplete,
    reopen: onReopen,
    skip: onSkip,
    advance: onAdvance
  }

  return (
    <div className="stage-actions">
      {stageActionList(stage, kind, isCurrent, isLast).map((action) => (
        <button
          key={action.type}
          type="button"
          className={`stage-actions__btn stage-actions__btn--${action.type}`}
          aria-label={action.ariaLabel}
          onClick={handlers[action.type]}
        >
          {action.label}
        </button>
      ))}
    </div>
  )
}
