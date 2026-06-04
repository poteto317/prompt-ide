import { describe, it, expect } from 'vitest'
import type { Task } from '../../types'
import { createTask } from '../taskFactory'
import { createStageEvent } from '../stageEventFactory'
import { recordStageEvent, completeStage, skipStage } from '../stageTransitions'

function baseTask(): Task {
  return createTask('テストタスク')
}

function stageOf(task: Task, id: string) {
  const stage = task.stages.find((s) => s.id === id)
  if (!stage) throw new Error(`stage not found: ${id}`)
  return stage
}

describe('recordStageEvent', () => {
  it('events に追加され回数が増える', () => {
    const next = recordStageEvent(baseTask(), 'refactor', createStageEvent('一回目'))
    expect(stageOf(next, 'refactor').events).toHaveLength(1)
    expect(stageOf(next, 'refactor').events[0].note).toBe('一回目')
  })

  it('未着手から in_progress に変わる', () => {
    const next = recordStageEvent(baseTask(), 'refactor', createStageEvent())
    expect(stageOf(next, 'refactor').status).toBe('in_progress')
  })

  it('done ステージに記録しても status は done のまま', () => {
    const done = completeStage(baseTask(), 'refactor')
    const next = recordStageEvent(done, 'refactor', createStageEvent())
    expect(stageOf(next, 'refactor').status).toBe('done')
    expect(stageOf(next, 'refactor').events).toHaveLength(1)
  })

  it('in_progress ステージは status が変わらない', () => {
    const task = recordStageEvent(baseTask(), 'refactor', createStageEvent())
    const next = recordStageEvent(task, 'refactor', createStageEvent('二回目'))
    expect(stageOf(next, 'refactor').status).toBe('in_progress')
  })

  it('複数回記録すると events が累積する', () => {
    let task = baseTask()
    task = recordStageEvent(task, 'commit', createStageEvent('1'))
    task = recordStageEvent(task, 'commit', createStageEvent('2'))
    expect(stageOf(task, 'commit').events).toHaveLength(2)
  })

  it('updatedAt が更新される', () => {
    const task = { ...baseTask(), updatedAt: Date.now() - 1000 }
    const next = recordStageEvent(task, 'commit', createStageEvent())
    expect(next.updatedAt).toBeGreaterThan(task.updatedAt)
  })

  it('元のタスクを変更しない（イミュータブル）', () => {
    const task = baseTask()
    recordStageEvent(task, 'commit', createStageEvent())
    expect(stageOf(task, 'commit').events).toHaveLength(0)
  })

  it('他のステージには影響しない', () => {
    const next = recordStageEvent(baseTask(), 'refactor', createStageEvent())
    expect(stageOf(next, 'plan').status).toBe('not_started')
    expect(stageOf(next, 'commit').events).toHaveLength(0)
  })
})

describe('completeStage', () => {
  it('status が done になる', () => {
    const next = completeStage(baseTask(), 'prCreate')
    expect(stageOf(next, 'prCreate').status).toBe('done')
  })

  it('event を渡すと events が 1 件化される', () => {
    let task = baseTask()
    task = recordStageEvent(task, 'prCreate', createStageEvent('古い'))
    const next = completeStage(task, 'prCreate', createStageEvent('PR #1', { prNumber: '1' }))
    expect(stageOf(next, 'prCreate').events).toHaveLength(1)
    expect(stageOf(next, 'prCreate').events[0].meta).toEqual({ prNumber: '1' })
  })

  it('event を渡さなければ既存 events を保持する', () => {
    let task = baseTask()
    task = recordStageEvent(task, 'localReview', createStageEvent('a'))
    const next = completeStage(task, 'localReview')
    expect(stageOf(next, 'localReview').events).toHaveLength(1)
  })

  it('updatedAt が更新される', () => {
    const task = { ...baseTask(), updatedAt: Date.now() - 1000 }
    const next = completeStage(task, 'plan')
    expect(next.updatedAt).toBeGreaterThan(task.updatedAt)
  })

  it('元のタスクを変更しない（イミュータブル）', () => {
    const task = baseTask()
    completeStage(task, 'plan')
    expect(stageOf(task, 'plan').status).toBe('not_started')
  })
})

describe('skipStage', () => {
  it('status が skipped になる', () => {
    const next = skipStage(baseTask(), 'refactor')
    expect(stageOf(next, 'refactor').status).toBe('skipped')
  })

  it('他のステージには影響しない', () => {
    const next = skipStage(baseTask(), 'refactor')
    expect(stageOf(next, 'plan').status).toBe('not_started')
    expect(stageOf(next, 'commit').status).toBe('not_started')
  })

  it('updatedAt が更新される', () => {
    const task = { ...baseTask(), updatedAt: Date.now() - 1000 }
    const next = skipStage(task, 'refactor')
    expect(next.updatedAt).toBeGreaterThan(task.updatedAt)
  })

  it('元のタスクを変更しない（イミュータブル）', () => {
    const task = baseTask()
    skipStage(task, 'refactor')
    expect(stageOf(task, 'refactor').status).toBe('not_started')
  })
})
