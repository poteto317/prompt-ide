import { useCallback } from 'react'
import type { Task } from '../types'
import * as progressApi from '../lib/progressApi'

interface ProgressTasksPersistence {
  load: () => Promise<Task[]>
  save: (tasks: Task[]) => void
}

export function useProgressTasksPersistence(): ProgressTasksPersistence {
  const load = useCallback(async (): Promise<Task[]> => {
    try {
      return await progressApi.loadTasks()
    } catch (err) {
      console.error('[useProgressTasksPersistence] load failed:', err)
      return []
    }
  }, [])

  const save = useCallback((tasks: Task[]): void => {
    progressApi
      .saveTasks(tasks)
      .catch((err) => console.error('[useProgressTasksPersistence] save failed:', err))
  }, [])

  return { load, save }
}
