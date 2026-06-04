import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Task } from '../../types'

const mockLoadTasks = vi.hoisted(() => vi.fn())
const mockSaveTasks = vi.hoisted(() => vi.fn())

vi.mock('../../lib/progressApi', () => ({
  loadTasks: mockLoadTasks,
  saveTasks: mockSaveTasks
}))

import { useProgressTasksPersistence } from '../useProgressTasksPersistence'

const sampleTask: Task = {
  id: 't1',
  title: 'テストタスク',
  createdAt: 1000,
  updatedAt: 2000,
  currentStageId: 'plan',
  stages: []
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('load', () => {
  it('progressApi.loadTasks に委譲してタスク配列を返す', async () => {
    mockLoadTasks.mockResolvedValue([sampleTask])
    const { result } = renderHook(() => useProgressTasksPersistence())
    const tasks = await result.current.load()
    expect(mockLoadTasks).toHaveBeenCalledOnce()
    expect(tasks).toEqual([sampleTask])
  })

  it('loadTasks がエラーをスローしたとき空配列を返す', async () => {
    mockLoadTasks.mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => useProgressTasksPersistence())
    const tasks = await result.current.load()
    expect(tasks).toEqual([])
  })

  it('loadTasks がエラーのときコンソールエラーを出力する', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockLoadTasks.mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => useProgressTasksPersistence())
    await result.current.load()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })

  it('空配列が返っても正常に動作する', async () => {
    mockLoadTasks.mockResolvedValue([])
    const { result } = renderHook(() => useProgressTasksPersistence())
    const tasks = await result.current.load()
    expect(tasks).toEqual([])
  })
})

describe('save', () => {
  it('progressApi.saveTasks にタスク配列を渡す', async () => {
    mockSaveTasks.mockResolvedValue(undefined)
    const { result } = renderHook(() => useProgressTasksPersistence())
    result.current.save([sampleTask])
    await vi.waitFor(() => expect(mockSaveTasks).toHaveBeenCalledWith([sampleTask]))
  })

  it('空配列を渡しても正常に動作する', async () => {
    mockSaveTasks.mockResolvedValue(undefined)
    const { result } = renderHook(() => useProgressTasksPersistence())
    result.current.save([])
    await vi.waitFor(() => expect(mockSaveTasks).toHaveBeenCalledWith([]))
  })

  it('saveTasks がエラーをスローしてもクラッシュしない', async () => {
    mockSaveTasks.mockRejectedValue(new Error('disk full'))
    const { result } = renderHook(() => useProgressTasksPersistence())
    expect(() => result.current.save([sampleTask])).not.toThrow()
  })

  it('saveTasks がエラーのときコンソールエラーを出力する', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSaveTasks.mockRejectedValue(new Error('disk full'))
    const { result } = renderHook(() => useProgressTasksPersistence())
    result.current.save([sampleTask])
    await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled())
    consoleSpy.mockRestore()
  })
})
