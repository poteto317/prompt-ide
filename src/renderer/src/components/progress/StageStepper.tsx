'use client'
import type { StageId, Task } from '../../types'
import { STAGES } from '../../config/stageConfig'
import StageRow from './StageRow'

interface Props {
  task: Task
  onRecord: (stageId: StageId, note?: string) => void
  onComplete: (stageId: StageId) => void
  onReopen: (stageId: StageId) => void
  onSkip: (stageId: StageId) => void
  onAdvance: () => void
}

export default function StageStepper({
  task,
  onRecord,
  onComplete,
  onReopen,
  onSkip,
  onAdvance
}: Props) {
  return (
    <ul className="stage-stepper" role="list">
      {STAGES.map((definition, index) => {
        const stage = task.stages.find((s) => s.id === definition.id)
        if (!stage) return null
        return (
          <StageRow
            key={definition.id}
            stage={stage}
            definition={definition}
            index={index}
            isCurrent={task.currentStageId === definition.id}
            isLast={index === STAGES.length - 1}
            onRecord={(note) => onRecord(definition.id, note)}
            onComplete={() => onComplete(definition.id)}
            onReopen={() => onReopen(definition.id)}
            onSkip={() => onSkip(definition.id)}
            onAdvance={onAdvance}
          />
        )
      })}
    </ul>
  )
}
