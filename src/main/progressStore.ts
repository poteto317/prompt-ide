import { createJsonCollectionStore } from './jsonCollectionStore'
import { isValidTask } from './progressValidation'
import { sanitizeTask } from './progressSanitize'
import { STAGE_IDS } from './progressConstants'
import type { Task } from '@shared/types'

function migrateRawTask(item: unknown): unknown {
  if (typeof item !== 'object' || item === null) return item
  const t = item as Record<string, unknown>
  if (!Array.isArray(t.stages)) return item

  const existingIds = new Set(
    (t.stages as unknown[])
      .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
      .map((s) => s.id)
      .filter((id): id is string => typeof id === 'string')
  )

  const missingStages = STAGE_IDS.filter((id) => !existingIds.has(id)).map((id) => ({
    id,
    status: 'not_started',
    events: []
  }))

  if (missingStages.length === 0) return item
  return { ...t, stages: [...(t.stages as unknown[]), ...missingStages] }
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
