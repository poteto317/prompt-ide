import { describe, it, expect } from 'vitest'
import { isValidTask } from '../progressValidation'
import type { Task } from '@shared/types'

const ALL_STAGES: Task['stages'] = [
  { id: 'plan', status: 'in_progress', events: [{ id: 'e1', occurredAt: 500, note: 'メモ', meta: { commit: 'abc' } }] },
  { id: 'implement', status: 'not_started', events: [] },
  { id: 'refactor', status: 'not_started', events: [] },
  { id: 'localReview', status: 'not_started', events: [] },
  { id: 'commit', status: 'not_started', events: [] },
  { id: 'prCreate', status: 'not_started', events: [] },
  { id: 'prReview', status: 'not_started', events: [] },
  { id: 'prMerge', status: 'not_started', events: [] }
]

const validTask: Task = {
  id: 't1',
  title: 'タスク',
  createdAt: 1000,
  updatedAt: 2000,
  currentStageId: 'plan',
  stages: ALL_STAGES
}

describe('isValidTask', () => {
  it('正常なタスクを受け入れる', () => {
    expect(isValidTask(validTask)).toBe(true)
  })

  it('null を拒否する', () => {
    expect(isValidTask(null)).toBe(false)
  })

  it('オブジェクト以外（文字列）を拒否する', () => {
    expect(isValidTask('task')).toBe(false)
  })

  it('id が string でないと拒否する', () => {
    expect(isValidTask({ ...validTask, id: 1 })).toBe(false)
  })

  it('title が string でないと拒否する', () => {
    expect(isValidTask({ ...validTask, title: 123 })).toBe(false)
  })

  it('createdAt が非数値だと拒否する', () => {
    expect(isValidTask({ ...validTask, createdAt: '1000' })).toBe(false)
  })

  it('createdAt が NaN だと拒否する', () => {
    expect(isValidTask({ ...validTask, createdAt: NaN })).toBe(false)
  })

  it('updatedAt が Infinity だと拒否する', () => {
    expect(isValidTask({ ...validTask, updatedAt: Infinity })).toBe(false)
  })

  it('未知の currentStageId を拒否する', () => {
    expect(isValidTask({ ...validTask, currentStageId: 'unknown' })).toBe(false)
  })

  it('全ての既知 stage id を currentStageId として受け入れる', () => {
    const ids = [
      'plan',
      'implement',
      'refactor',
      'localReview',
      'commit',
      'prCreate',
      'prReview',
      'prMerge'
    ]
    for (const id of ids) {
      expect(isValidTask({ ...validTask, currentStageId: id })).toBe(true)
    }
  })

  it('stages が配列でないと拒否する', () => {
    expect(isValidTask({ ...validTask, stages: {} })).toBe(false)
  })

  it('全 8 ステージが揃っていない（欠落あり）場合は拒否する', () => {
    expect(isValidTask({ ...validTask, stages: ALL_STAGES.slice(0, 7) })).toBe(false)
  })

  it('stages に重複した id が含まれる場合は拒否する', () => {
    const duplicated = [...ALL_STAGES.slice(0, 7), { ...ALL_STAGES[0] }]
    expect(isValidTask({ ...validTask, stages: duplicated })).toBe(false)
  })

  it('currentStageId が stages に存在しない場合は拒否する', () => {
    const stagesWithoutPlan = ALL_STAGES.filter((s) => s.id !== 'plan')
    expect(isValidTask({ ...validTask, currentStageId: 'plan', stages: stagesWithoutPlan })).toBe(false)
  })

  it('未知の stage id を拒否する', () => {
    expect(isValidTask({ ...validTask, stages: [{ id: 'xxx', status: 'done', events: [] }] })).toBe(
      false
    )
  })

  it('未知の status を拒否する', () => {
    expect(
      isValidTask({ ...validTask, stages: [{ id: 'plan', status: 'unknown', events: [] }] })
    ).toBe(false)
  })

  it('stage の events が配列でないと拒否する', () => {
    expect(
      isValidTask({ ...validTask, stages: [{ id: 'plan', status: 'done', events: null }] })
    ).toBe(false)
  })

  it('event の id が string でないと拒否する', () => {
    expect(
      isValidTask({
        ...validTask,
        stages: [{ id: 'plan', status: 'done', events: [{ id: 1, occurredAt: 1 }] }]
      })
    ).toBe(false)
  })

  it('event の occurredAt が非数値だと拒否する', () => {
    expect(
      isValidTask({
        ...validTask,
        stages: [{ id: 'plan', status: 'done', events: [{ id: 'e', occurredAt: 'x' }] }]
      })
    ).toBe(false)
  })

  it('event の note が string 以外だと拒否する', () => {
    expect(
      isValidTask({
        ...validTask,
        stages: [{ id: 'plan', status: 'done', events: [{ id: 'e', occurredAt: 1, note: 5 }] }]
      })
    ).toBe(false)
  })

  it('event の meta が配列だと拒否する', () => {
    expect(
      isValidTask({
        ...validTask,
        stages: [{ id: 'plan', status: 'done', events: [{ id: 'e', occurredAt: 1, meta: [] }] }]
      })
    ).toBe(false)
  })

  it('event の meta が文字列以外の値を含むと拒否する', () => {
    expect(
      isValidTask({
        ...validTask,
        stages: [
          { id: 'plan', status: 'done', events: [{ id: 'e', occurredAt: 1, meta: { n: 1 } }] }
        ]
      })
    ).toBe(false)
  })
})
