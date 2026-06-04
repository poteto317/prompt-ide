import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadTasks, saveTasks } from '../progressApi'
import type { Task } from '../../types'

const sampleTask: Task = {
  id: 't1',
  title: 'タスク',
  createdAt: 1,
  updatedAt: 2,
  currentStageId: 'plan',
  stages: []
}

beforeEach(() => {
  window.api.loadTasks = vi.fn().mockResolvedValue([sampleTask])
  window.api.saveTasks = vi.fn().mockResolvedValue(undefined)
})

describe('progressApi', () => {
  it('loadTasks は window.api.loadTasks に委譲する', async () => {
    const result = await loadTasks()
    expect(window.api.loadTasks).toHaveBeenCalledOnce()
    expect(result).toEqual([sampleTask])
  })

  it('saveTasks は window.api.saveTasks に委譲する', async () => {
    await saveTasks([sampleTask])
    expect(window.api.saveTasks).toHaveBeenCalledWith([sampleTask])
  })
})
