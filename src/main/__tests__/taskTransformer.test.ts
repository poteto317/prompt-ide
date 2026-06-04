import { describe, it, expect } from 'vitest'
import { toTask } from '../taskTransformer'
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
      status: 'done',
      events: [{ id: 'e1', occurredAt: 500, note: 'メモ', meta: { commit: 'abc' } }]
    }
  ]
}

describe('toTask', () => {
  describe('正常系', () => {
    it('有効なタスクを Task として返す', () => {
      const result = toTask(validTask)
      expect(result.id).toBe('t1')
      expect(result.title).toBe('タスク')
    })

    it('余分なプロパティが除去される', () => {
      const withExtra = { ...validTask, extra: 'ignored', another: 42 }
      const result = toTask(withExtra)
      expect(result).not.toHaveProperty('extra')
      expect(result).not.toHaveProperty('another')
    })

    it('ネストした余分なプロパティも除去される', () => {
      const withExtraInStage = {
        ...validTask,
        stages: [{ ...validTask.stages[0], unexpected: 'field' }]
      }
      const result = toTask(withExtraInStage)
      expect(result.stages[0]).not.toHaveProperty('unexpected')
    })

    it('event の meta 内の値がすべて string なら meta がそのまま残る', () => {
      const result = toTask(validTask)
      expect(result.stages[0].events[0].meta).toEqual({ commit: 'abc' })
    })

    it('meta に string 以外の値が含まれているタスクはエラーをスロー（バリデーションで弾かれる）', () => {
      const withBadMeta = {
        ...validTask,
        stages: [
          {
            ...validTask.stages[0],
            events: [{ id: 'e1', occurredAt: 500, meta: { commit: 'abc', badNum: 99 as unknown as string } }]
          }
        ]
      }
      expect(() => toTask(withBadMeta)).toThrow('タスクの形式が不正です')
    })

    it('ステージが空配列のタスクも変換できる', () => {
      const result = toTask({ ...validTask, stages: [] })
      expect(result.stages).toEqual([])
    })
  })

  describe('異常系', () => {
    it('null を渡すとエラーをスロー', () => {
      expect(() => toTask(null)).toThrow('タスクの形式が不正です')
    })

    it('undefined を渡すとエラーをスロー', () => {
      expect(() => toTask(undefined)).toThrow('タスクの形式が不正です')
    })

    it('文字列を渡すとエラーをスロー', () => {
      expect(() => toTask('not-a-task')).toThrow('タスクの形式が不正です')
    })

    it('id が数値のオブジェクトはエラーをスロー', () => {
      expect(() => toTask({ ...validTask, id: 1 })).toThrow('タスクの形式が不正です')
    })

    it('未知の currentStageId はエラーをスロー', () => {
      expect(() => toTask({ ...validTask, currentStageId: 'unknown' })).toThrow(
        'タスクの形式が不正です'
      )
    })

    it('createdAt が NaN のときエラーをスロー', () => {
      expect(() => toTask({ ...validTask, createdAt: NaN })).toThrow('タスクの形式が不正です')
    })

    it('不正な stage を含む場合エラーをスロー', () => {
      expect(() =>
        toTask({ ...validTask, stages: [{ id: 'xxx', status: 'done', events: [] }] })
      ).toThrow('タスクの形式が不正です')
    })
  })
})
