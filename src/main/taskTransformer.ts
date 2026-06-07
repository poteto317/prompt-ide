import type { Task } from '@shared/types'
import { isValidTask } from './progressValidation'
import { sanitizeTask } from './progressSanitize'

export function toTask(item: unknown): Task {
  if (!isValidTask(item)) throw new Error('タスクの形式が不正です')
  return sanitizeTask(item)
}
