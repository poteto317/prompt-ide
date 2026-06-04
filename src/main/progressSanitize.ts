import type { Stage, StageEvent, Task } from '@shared/types'

function sanitizeStageEvent(event: StageEvent): StageEvent {
  const sanitized: StageEvent = { id: event.id, occurredAt: event.occurredAt }
  if (event.note !== undefined) sanitized.note = event.note
  if (event.meta !== undefined) {
    sanitized.meta = Object.fromEntries(
      Object.entries(event.meta).filter(([, v]) => typeof v === 'string')
    )
  }
  return sanitized
}

function sanitizeStage(stage: Stage): Stage {
  return {
    id: stage.id,
    status: stage.status,
    events: stage.events.map(sanitizeStageEvent)
  }
}

export function sanitizeTask(item: Task): Task {
  const { id, title, createdAt, updatedAt, currentStageId, stages } = item
  return {
    id,
    title,
    createdAt,
    updatedAt,
    currentStageId,
    stages: stages.map(sanitizeStage)
  }
}
