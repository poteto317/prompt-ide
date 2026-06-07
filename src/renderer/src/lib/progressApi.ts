import type { Task } from '../types'

export function loadTasks(): Promise<Task[]> {
  return window.api.loadTasks()
}

export function saveTasks(tasks: Task[]): Promise<void> {
  return window.api.saveTasks(tasks)
}
