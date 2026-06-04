import { describe, it, expect } from 'vitest'
import type { Task } from '../../types'
import { createTask } from '../taskFactory'
import { createStageEvent } from '../stageEventFactory'
import { completeStage, recordStageEvent, skipStage } from '../stageTransitions'
import { reopenStage, advanceCurrentStage } from '../stageNavigation'

function baseTask(): Task {
  return createTask('テストタスク')
}

function stageOf(task: Task, id: string) {
  const stage = task.stages.find((s) => s.id === id)
  if (!stage) throw new Error(`stage not found: ${id}`)
  return stage
}

describe('reopenStage', () => {
  it('履歴があるステージは in_progress に戻る', () => {
    let task = baseTask()
    task = recordStageEvent(task, 'refactor', createStageEvent())
    task = completeStage(task, 'refactor')
    const next = reopenStage(task, 'refactor')
    expect(stageOf(next, 'refactor').status).toBe('in_progress')
  })

  it('履歴が無いステージは not_started に戻る', () => {
    const done = completeStage(baseTask(), 'prCreate')
    const next = reopenStage(done, 'prCreate')
    expect(stageOf(next, 'prCreate').status).toBe('not_started')
  })

  it('currentStageId が対象ステージになる', () => {
    const next = reopenStage(baseTask(), 'refactor')
    expect(next.currentStageId).toBe('refactor')
  })

  it('後続の done ステージは再確認のため in_progress に落ちる', () => {
    let task = baseTask()
    task = completeStage(task, 'commit')
    task = completeStage(task, 'prCreate')
    const next = reopenStage(task, 'refactor')
    expect(stageOf(next, 'commit').status).toBe('in_progress')
    expect(stageOf(next, 'prCreate').status).toBe('in_progress')
  })

  it('対象より前の done ステージは変化しない', () => {
    let task = baseTask()
    task = completeStage(task, 'plan')
    task = completeStage(task, 'refactor')
    const next = reopenStage(task, 'refactor')
    expect(stageOf(next, 'plan').status).toBe('done')
  })

  it('後続の skipped ステージは変化しない', () => {
    let task = baseTask()
    task = skipStage(task, 'commit')
    const next = reopenStage(task, 'refactor')
    expect(stageOf(next, 'commit').status).toBe('skipped')
  })

  it('後続の not_started ステージは変化しない', () => {
    const next = reopenStage(baseTask(), 'plan')
    expect(stageOf(next, 'implement').status).toBe('not_started')
  })

  it('存在しないステージなら同一タスクを返す', () => {
    const task = baseTask()
    const next = reopenStage(task, 'unknown' as never)
    expect(next).toBe(task)
  })

  it('updatedAt が更新される', () => {
    const task = { ...baseTask(), updatedAt: Date.now() - 1000 }
    const next = reopenStage(task, 'plan')
    expect(next.updatedAt).toBeGreaterThan(task.updatedAt)
  })

  it('元のタスクを変更しない（イミュータブル）', () => {
    const task = baseTask()
    reopenStage(task, 'refactor')
    expect(task.currentStageId).toBe('plan')
  })
})

describe('advanceCurrentStage', () => {
  it('現在ステージが done になり次へ進む', () => {
    const task = baseTask()
    const next = advanceCurrentStage(task)
    expect(stageOf(next, 'plan').status).toBe('done')
    expect(next.currentStageId).toBe('implement')
  })

  it('次のステージが not_started なら in_progress になる', () => {
    const next = advanceCurrentStage(baseTask())
    expect(stageOf(next, 'implement').status).toBe('in_progress')
  })

  it('次のステージがすでに in_progress なら変化しない', () => {
    let task = baseTask()
    task = recordStageEvent(task, 'implement', createStageEvent())
    const next = advanceCurrentStage(task)
    expect(stageOf(next, 'implement').status).toBe('in_progress')
  })

  it('次のステージがすでに done なら done のまま currentStageId だけ進む', () => {
    let task = baseTask()
    task = completeStage(task, 'implement')
    const next = advanceCurrentStage(task)
    // currentStageId は plan → implement に進む
    expect(next.currentStageId).toBe('implement')
    // implement は done のまま（not_started でないため in_progress にはならない）
    expect(stageOf(next, 'implement').status).toBe('done')
    // plan は done になる
    expect(stageOf(next, 'plan').status).toBe('done')
  })

  it('次のステージがすでに skipped なら skipped のまま currentStageId だけ進む', () => {
    let task = baseTask()
    task = skipStage(task, 'implement')
    const next = advanceCurrentStage(task)
    expect(next.currentStageId).toBe('implement')
    expect(stageOf(next, 'implement').status).toBe('skipped')
  })

  it('skipped の現在ステージは done に上書きしない', () => {
    let task = baseTask()
    task = skipStage(task, 'plan')
    const next = advanceCurrentStage(task)
    expect(stageOf(next, 'plan').status).toBe('skipped')
    expect(next.currentStageId).toBe('implement')
  })

  it('最終ステージでは currentStageId を進めない', () => {
    const task = { ...baseTask(), currentStageId: 'prMerge' as const }
    const next = advanceCurrentStage(task)
    expect(next.currentStageId).toBe('prMerge')
    expect(stageOf(next, 'prMerge').status).toBe('done')
  })

  it('updatedAt が更新される', () => {
    const task = { ...baseTask(), updatedAt: Date.now() - 1000 }
    const next = advanceCurrentStage(task)
    expect(next.updatedAt).toBeGreaterThan(task.updatedAt)
  })

  it('元のタスクを変更しない（イミュータブル）', () => {
    const task = baseTask()
    advanceCurrentStage(task)
    expect(task.currentStageId).toBe('plan')
    expect(stageOf(task, 'plan').status).toBe('not_started')
  })

  it('存在しない currentStageId なら同一タスクを返す', () => {
    const task = { ...baseTask(), currentStageId: 'unknown' as never }
    const next = advanceCurrentStage(task)
    expect(next).toBe(task)
  })
})
