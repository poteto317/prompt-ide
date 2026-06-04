import { useCallback } from 'react'
import type { StageId, Task } from '../types'
import { createTask } from '../lib/taskFactory'
import { useProgressTasksPersistence } from './useProgressTasksPersistence'
import { useBufferedPersistence } from './useBufferedPersistence'
import { useStageOperations } from './useStageOperations'

interface ProgressTasksState {
  tasks: Task[]
  tasksLoaded: boolean
  addTask: (title: string) => void
  deleteTask: (id: string) => void
  recordEvent: (taskId: string, stageId: StageId, note?: string) => void
  completeStage: (taskId: string, stageId: StageId, note?: string) => void
  reopenStage: (taskId: string, stageId: StageId) => void
  skipStage: (taskId: string, stageId: StageId) => void
  advanceStage: (taskId: string) => void
}

export function useProgressTasks(): ProgressTasksState {
  const { load, save } = useProgressTasksPersistence()
  const { items: tasks, loaded: tasksLoaded, apply } = useBufferedPersistence<Task>({ load, save })

  const updateTask = useCallback(
    (taskId: string, fn: (task: Task) => Task): void => {
      apply((tasks) => tasks.map((task) => (task.id === taskId ? fn(task) : task)))
    },
    [apply]
  )

  const addTask = useCallback(
    (title: string): void => {
      const newTask = createTask(title)
      apply((tasks) => [...tasks, newTask])
    },
    [apply]
  )

  const deleteTask = useCallback(
    (id: string): void => {
      apply((tasks) => tasks.filter((task) => task.id !== id))
    },
    [apply]
  )

  const stageOperations = useStageOperations(updateTask)

  return {
    tasks,
    tasksLoaded,
    addTask,
    deleteTask,
    ...stageOperations
  }
}
