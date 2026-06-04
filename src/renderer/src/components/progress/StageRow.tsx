'use client'
import { useState } from 'react'
import type { Stage } from '../../types'
import type { StageDefinition } from '../../config/stageConfig'
import StageActions from './StageActions'
import StageHistory from './StageHistory'
import StageRowHeader from './StageRowHeader'

interface Props {
  stage: Stage
  definition: StageDefinition
  index: number
  isCurrent: boolean
  isLast: boolean
  onRecord: (note?: string) => void
  onComplete: () => void
  onReopen: () => void
  onSkip: () => void
  onAdvance: () => void
}

export default function StageRow({
  stage,
  definition,
  index,
  isCurrent,
  isLast,
  onRecord,
  onComplete,
  onReopen,
  onSkip,
  onAdvance
}: Props) {
  const [expanded, setExpanded] = useState(false)

  return (
    <li
      className={`stage-row${isCurrent ? ' stage-row--current' : ''} stage-row--${stage.status}`}
      role="listitem"
      aria-current={isCurrent ? 'step' : undefined}
    >
      <StageRowHeader
        stage={stage}
        definition={definition}
        index={index}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
      />

      <StageActions
        stage={stage}
        kind={definition.kind}
        isCurrent={isCurrent}
        isLast={isLast}
        onComplete={onComplete}
        onReopen={onReopen}
        onSkip={onSkip}
        onAdvance={onAdvance}
      />

      {expanded && <StageHistory stage={stage} kind={definition.kind} onRecord={onRecord} />}
    </li>
  )
}
