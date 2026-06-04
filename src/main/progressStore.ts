import { createJsonCollectionStore } from './jsonCollectionStore'
import { isValidTask } from './progressValidation'
import { sanitizeTask } from './progressSanitize'
import type { Task } from '@shared/types'

const store = createJsonCollectionStore<Task>({
  fileName: 'progress.json',
  isValid: isValidTask,
  sanitize: sanitizeTask
})

export function loadTasks(): Promise<Task[]> {
  return store.load()
}

export function saveTasks(tasks: Task[]): Promise<void> {
  return store.save(tasks)
}
