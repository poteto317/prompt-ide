import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Task } from '@shared/types'

const mockHandle = vi.hoisted(() => vi.fn())
const mockLoadTasks = vi.hoisted(() => vi.fn())
const mockSaveTasks = vi.hoisted(() => vi.fn())

vi.mock('../../progressStore', () => ({
  loadTasks: mockLoadTasks,
  saveTasks: mockSaveTasks
}))

import { registerProgressHandlers } from '../../handlers/progressHandlers'

const mockIpcMain = { handle: mockHandle } as never

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent() {
  return { sender: { id: 1 } }
}

const sampleTask: Task = {
  id: 't1',
  title: 'タスク',
  createdAt: 1000,
  updatedAt: 2000,
  currentStageId: 'plan',
  stages: [
    { id: 'plan', status: 'done', events: [{ id: 'e1', occurredAt: 500 }] },
    { id: 'implement', status: 'not_started', events: [] },
    { id: 'refactor', status: 'not_started', events: [] },
    { id: 'localReview', status: 'not_started', events: [] },
    { id: 'commit', status: 'not_started', events: [] },
    { id: 'prCreate', status: 'not_started', events: [] },
    { id: 'prReview', status: 'not_started', events: [] },
    { id: 'prMerge', status: 'not_started', events: [] }
  ]
}

beforeEach(() => {
  vi.clearAllMocks()
  registerProgressHandlers(mockIpcMain)
})

describe('registerProgressHandlers', () => {
  describe('progress:load', () => {
    it('loadTasks に委譲して配列を返す', async () => {
      mockLoadTasks.mockResolvedValue([sampleTask])
      const result = await getRegisteredHandler('progress:load')(makeEvent())
      expect(mockLoadTasks).toHaveBeenCalledOnce()
      expect(result).toEqual([sampleTask])
    })
  })

  describe('progress:save', () => {
    it('タスク配列を saveTasks に渡す', async () => {
      mockSaveTasks.mockResolvedValue(undefined)
      await getRegisteredHandler('progress:save')(makeEvent(), [sampleTask])
      expect(mockSaveTasks).toHaveBeenCalledWith([sampleTask])
    })

    it('空配列を saveTasks に渡せる', async () => {
      mockSaveTasks.mockResolvedValue(undefined)
      await getRegisteredHandler('progress:save')(makeEvent(), [])
      expect(mockSaveTasks).toHaveBeenCalledWith([])
    })

    it('payload が配列でないとき "引数は配列である必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('progress:save')(makeEvent(), { not: 'array' })
      ).rejects.toThrow('引数は配列である必要があります')
      expect(mockSaveTasks).not.toHaveBeenCalled()
    })

    it('不正な形式の要素があると saveTasks は呼ばれない', async () => {
      await expect(getRegisteredHandler('progress:save')(makeEvent(), [{ id: 1 }])).rejects.toThrow()
      expect(mockSaveTasks).not.toHaveBeenCalled()
    })

    it('不正な形式の要素があると "タスクデータの形式が不正です" を含むエラーをスロー', async () => {
      await expect(
        getRegisteredHandler('progress:save')(makeEvent(), [{ id: 1 }])
      ).rejects.toThrow('タスクデータの形式が不正です')
      expect(mockSaveTasks).not.toHaveBeenCalled()
    })
  })
})
