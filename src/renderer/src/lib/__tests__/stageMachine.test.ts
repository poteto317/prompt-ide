// stageMachine.ts はバレルです。各モジュールの詳細テストは以下で行われます:
// - stageTransitions.test.ts: recordStageEvent, completeStage, skipStage
// - stageNavigation.test.ts: reopenStage, advanceCurrentStage
import { describe, it, expect } from 'vitest'
import { createTask } from '../taskFactory'
import { createStageEvent } from '../stageEventFactory'
import { recordStageEvent, completeStage, skipStage, reopenStage, advanceCurrentStage } from '../stageMachine'

describe('stageMachine (barrel)', () => {
  it('recordStageEvent はステージにイベントを追加する', () => {
    const task = createTask('test')
    const next = recordStageEvent(task, 'plan', createStageEvent('メモ'))
    expect(next.stages.find((s) => s.id === 'plan')?.events).toHaveLength(1)
  })

  it('completeStage はステージを done にする', () => {
    const task = createTask('test')
    const next = completeStage(task, 'plan')
    expect(next.stages.find((s) => s.id === 'plan')?.status).toBe('done')
  })

  it('skipStage はステージを skipped にする', () => {
    const task = createTask('test')
    const next = skipStage(task, 'refactor')
    expect(next.stages.find((s) => s.id === 'refactor')?.status).toBe('skipped')
  })

  it('reopenStage は currentStageId を対象ステージに戻す', () => {
    const task = createTask('test')
    const next = reopenStage(task, 'plan')
    expect(next.currentStageId).toBe('plan')
  })

  it('advanceCurrentStage は currentStageId を次へ進める', () => {
    const task = createTask('test')
    const next = advanceCurrentStage(task)
    expect(next.currentStageId).toBe('implement')
  })
})
