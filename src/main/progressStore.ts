import { isObjectLike } from '@shared/typeGuards'
import { createJsonCollectionStore } from './jsonCollectionStore'
import { isValidTask } from './progressValidation'
import { sanitizeTask } from './progressSanitize'
import { STAGE_IDS } from './progressConstants'
import type { Stage, Task } from '@shared/types'

function migrateRawTask(item: unknown): unknown {
  if (!isObjectLike(item)) return item
  if (!Array.isArray(item.stages)) return item
  // Array.isArray は any[] に絞り込むため、要素を unknown として受け直す
  const stages: readonly unknown[] = item.stages

  const existingIds = new Set(
    stages
      .filter(isObjectLike)
      .map((s) => s.id)
      .filter((id): id is string => typeof id === 'string')
  )

  const missingStages: Stage[] = STAGE_IDS.filter((id) => !existingIds.has(id)).map((id) => ({
    id,
    status: 'not_started' as const,
    events: []
  }))

  if (missingStages.length === 0) return item
  return { ...item, stages: [...stages, ...missingStages] }
}

const store = createJsonCollectionStore<Task>({
  fileName: 'progress.json',
  isValid: isValidTask,
  sanitize: sanitizeTask,
  migrate: migrateRawTask
})

export function loadTasks(): Promise<Task[]> {
  return store.load()
}

export function saveTasks(tasks: Task[]): Promise<void> {
  return store.save(tasks)
}
