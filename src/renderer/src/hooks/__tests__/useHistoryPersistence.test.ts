import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { HistoryEntry } from '../../types'

const mockLoadHistory = vi.hoisted(() => vi.fn())
const mockSaveHistory = vi.hoisted(() => vi.fn())

vi.mock('../../lib/historyApi', () => ({
  loadHistory: mockLoadHistory,
  saveHistory: mockSaveHistory
}))

import { useHistoryPersistence } from '../useHistoryPersistence'

const sampleEntry: HistoryEntry = {
  id: 'h1',
  promptId: 'p1',
  promptTitle: 'タイトル',
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'api',
  status: 'success',
  resultText: '結果',
  errorMessage: null,
  executedAt: 1000
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('load', () => {
  it('historyApi.loadHistory に委譲して履歴配列を返す', async () => {
    mockLoadHistory.mockResolvedValue([sampleEntry])
    const { result } = renderHook(() => useHistoryPersistence())
    const history = await result.current.load()
    expect(mockLoadHistory).toHaveBeenCalledOnce()
    expect(history).toEqual([sampleEntry])
  })

  it('loadHistory がエラーをスローしたとき空配列を返す', async () => {
    mockLoadHistory.mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => useHistoryPersistence())
    const history = await result.current.load()
    expect(history).toEqual([])
  })

  it('loadHistory がエラーのときコンソールエラーを出力する', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockLoadHistory.mockRejectedValue(new Error('network error'))
    const { result } = renderHook(() => useHistoryPersistence())
    await result.current.load()
    expect(consoleSpy).toHaveBeenCalled()
    consoleSpy.mockRestore()
  })
})

describe('save', () => {
  it('historyApi.saveHistory に履歴配列を渡す', async () => {
    mockSaveHistory.mockResolvedValue(undefined)
    const { result } = renderHook(() => useHistoryPersistence())
    result.current.save([sampleEntry])
    await vi.waitFor(() => expect(mockSaveHistory).toHaveBeenCalledWith([sampleEntry]))
  })

  it('saveHistory がエラーをスローしてもクラッシュしない', async () => {
    mockSaveHistory.mockRejectedValue(new Error('disk full'))
    const { result } = renderHook(() => useHistoryPersistence())
    expect(() => result.current.save([sampleEntry])).not.toThrow()
  })

  it('saveHistory がエラーのときコンソールエラーを出力する', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockSaveHistory.mockRejectedValue(new Error('disk full'))
    const { result } = renderHook(() => useHistoryPersistence())
    result.current.save([sampleEntry])
    await vi.waitFor(() => expect(consoleSpy).toHaveBeenCalled())
    consoleSpy.mockRestore()
  })
})
