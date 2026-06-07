import { describe, it, expect } from 'vitest'
import { createTask } from '../taskFactory'
import { STAGES } from '../../config/stageConfig'

describe('createTask', () => {
  it('title を持つ Task を返す', () => {
    const task = createTask('機能追加')
    expect(task.title).toBe('機能追加')
  })

  it('id が UUID 形式の文字列', () => {
    const { id } = createTask('t')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('同じ引数で 2 回呼ぶと異なる id になる', () => {
    expect(createTask('t').id).not.toBe(createTask('t').id)
  })

  it('createdAt と updatedAt が一致する数値', () => {
    const task = createTask('t')
    expect(typeof task.createdAt).toBe('number')
    expect(task.updatedAt).toBe(task.createdAt)
  })

  it('currentStageId は plan で始まる', () => {
    expect(createTask('t').currentStageId).toBe('plan')
  })

  it('全ステージが not_started・空 events で初期化される', () => {
    const task = createTask('t')
    expect(task.stages).toHaveLength(STAGES.length)
    task.stages.forEach((stage) => {
      expect(stage.status).toBe('not_started')
      expect(stage.events).toEqual([])
    })
  })

  it('ステージの順序が STAGES と一致する', () => {
    const task = createTask('t')
    expect(task.stages.map((s) => s.id)).toEqual(STAGES.map((s) => s.id))
  })
})

