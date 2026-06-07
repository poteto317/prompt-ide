import type { Stage, Task } from '../types'
import { STAGES } from '../config/stageConfig'

export function createTask(title: string): Task {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    title,
    createdAt: now,
    updatedAt: now,
    currentStageId: 'plan',
    stages: STAGES.map((s): Stage => ({ id: s.id, status: 'not_started', events: [] }))
  }
}
