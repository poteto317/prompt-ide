import { describe, it, expect } from 'vitest'
import { sanitizeTask } from '../progressSanitize'
import type { Task } from '@shared/types'

const validTask: Task = {
  id: 't1',
  title: 'タスク',
  createdAt: 1000,
  updatedAt: 2000,
  currentStageId: 'plan',
  stages: [
    {
      id: 'plan',
      status: 'in_progress',
      events: [{ id: 'e1', occurredAt: 500, note: 'メモ', meta: { commit: 'abc' } }]
    }
  ]
}

describe('sanitizeTask', () => {
  it('余分なプロパティを除去する', () => {
    const withExtra = { ...validTask, extra: 'x' } as Task & { extra: string }
    const result = sanitizeTask(withExtra)
    expect((result as Record<string, unknown>).extra).toBeUndefined()
    expect(result.id).toBe('t1')
  })

  it('既知のフィールドは保持する', () => {
    const result = sanitizeTask(validTask)
    expect(result).toEqual(validTask)
  })

  it('stage / event の余分なプロパティも除去する', () => {
    const dirty = {
      ...validTask,
      stages: [
        {
          id: 'plan',
          status: 'done',
          extra: 'x',
          events: [{ id: 'e1', occurredAt: 1, junk: 'y' }]
        }
      ]
    } as unknown as Task
    const result = sanitizeTask(dirty)
    expect((result.stages[0] as Record<string, unknown>).extra).toBeUndefined()
    expect((result.stages[0].events[0] as Record<string, unknown>).junk).toBeUndefined()
  })

  it('note / meta が無い event も扱える', () => {
    const task: Task = {
      ...validTask,
      stages: [{ id: 'plan', status: 'done', events: [{ id: 'e', occurredAt: 1 }] }]
    }
    const result = sanitizeTask(task)
    expect(result.stages[0].events[0]).toEqual({ id: 'e', occurredAt: 1 })
  })

  it('note は保持し meta は文字列値のみ残す', () => {
    const task = {
      ...validTask,
      stages: [
        {
          id: 'plan',
          status: 'done',
          events: [{ id: 'e', occurredAt: 1, note: 'n', meta: { a: 'x', b: 2 } }]
        }
      ]
    } as unknown as Task
    const result = sanitizeTask(task)
    expect(result.stages[0].events[0].note).toBe('n')
    expect(result.stages[0].events[0].meta).toEqual({ a: 'x' })
  })

  it('元のオブジェクトを変更しない（イミュータブル）', () => {
    const snapshot = JSON.parse(JSON.stringify(validTask))
    sanitizeTask(validTask)
    expect(validTask).toEqual(snapshot)
  })
})
