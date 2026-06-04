import { useCallback } from 'react'
import type { StageId, Task } from '../types'
import { createStageEvent } from '../lib/stageEventFactory'
import {
  recordStageEvent,
  completeStage as completeStageTransition,
  reopenStage as reopenStageTransition,
  skipStage as skipStageTransition,
  advanceCurrentStage
} from '../lib/stageMachine'

interface StageOperationsState {
  recordEvent: (taskId: string, stageId: StageId, note?: string) => void
  completeStage: (taskId: string, stageId: StageId, note?: string) => void
  reopenStage: (taskId: string, stageId: StageId) => void
  skipStage: (taskId: string, stageId: StageId) => void
  advanceStage: (taskId: string) => void
}

export function useStageOperations(
  updateTask: (taskId: string, fn: (task: Task) => Task) => void
): StageOperationsState {
  const recordEvent = useCallback(
    (taskId: string, stageId: StageId, note?: string): void => {
      updateTask(taskId, (task) => recordStageEvent(task, stageId, createStageEvent(note)))
    },
    [updateTask]
  )

  const completeStage = useCallback(
    (taskId: string, stageId: StageId, note?: string): void => {
      const trimmedNote = note?.trim()
      const hasNote = trimmedNote !== undefined && trimmedNote !== ''
      updateTask(taskId, (task) =>
        completeStageTransition(task, stageId, hasNote ? createStageEvent(trimmedNote) : undefined)
      )
    },
    [updateTask]
  )

  const reopenStage = useCallback(
    (taskId: string, stageId: StageId): void => {
      updateTask(taskId, (task) => reopenStageTransition(task, stageId))
    },
    [updateTask]
  )

  const skipStage = useCallback(
    (taskId: string, stageId: StageId): void => {
      updateTask(taskId, (task) => skipStageTransition(task, stageId))
    },
    [updateTask]
  )

  const advanceStage = useCallback(
    (taskId: string): void => {
      updateTask(taskId, (task) => advanceCurrentStage(task))
    },
    [updateTask]
  )

  return { recordEvent, completeStage, reopenStage, skipStage, advanceStage }
}
