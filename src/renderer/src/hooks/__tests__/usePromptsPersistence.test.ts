import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prompt } from '../../types'

const mockLoadPrompts = vi.hoisted(() => vi.fn())
const mockSavePrompts = vi.hoisted(() => vi.fn())

vi.mock('../../lib/promptsApi', () => ({
  loadPrompts: mockLoadPrompts,
  savePrompts: mockSavePrompts,
}))

import { usePromptsPersistence } from '../usePromptsPersistence'

const samplePrompt: Prompt = { id: 'p1', title: 'T', content: 'C', createdAt: 1 }

beforeEach(() => {
  vi.clearAllMocks()
  mockLoadPrompts.mockResolvedValue([])
  mockSavePrompts.mockResolvedValue(undefined)
})

describe('usePromptsPersistence', () => {
  describe('load', () => {
    it('promptsApi.loadPrompts を呼び出して配列を返す', async () => {
      mockLoadPrompts.mockResolvedValue([samplePrompt])
      const { result } = renderHook(() => usePromptsPersistence())
      const loaded = await act(() => result.current.load())
      expect(mockLoadPrompts).toHaveBeenCalledOnce()
      expect(loaded).toEqual([samplePrompt])
    })

    it('空配列を返す場合も正しく返す', async () => {
      mockLoadPrompts.mockResolvedValue([])
      const { result } = renderHook(() => usePromptsPersistence())
      const loaded = await act(() => result.current.load())
      expect(loaded).toEqual([])
    })

    it('loadPrompts が失敗したとき [] を返す', async () => {
      mockLoadPrompts.mockRejectedValue(new Error('load error'))
      const { result } = renderHook(() => usePromptsPersistence())
      const loaded = await act(() => result.current.load())
      expect(loaded).toEqual([])
    })

    it('loadPrompts が失敗したとき console.error を呼ぶ', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockLoadPrompts.mockRejectedValue(new Error('load error'))
      const { result } = renderHook(() => usePromptsPersistence())
      await act(() => result.current.load())
      expect(consoleSpy).toHaveBeenCalledWith(
        '[usePromptsPersistence] load failed:',
        expect.any(Error)
      )
      consoleSpy.mockRestore()
    })
  })

  describe('save', () => {
    it('promptsApi.savePrompts にプロンプト配列を渡して呼び出す', async () => {
      const { result } = renderHook(() => usePromptsPersistence())
      act(() => result.current.save([samplePrompt]))
      await vi.waitFor(() => expect(mockSavePrompts).toHaveBeenCalledWith([samplePrompt]))
    })

    it('空配列を渡せる', async () => {
      const { result } = renderHook(() => usePromptsPersistence())
      act(() => result.current.save([]))
      await vi.waitFor(() => expect(mockSavePrompts).toHaveBeenCalledWith([]))
    })

    it('savePrompts が失敗したとき console.error を呼ぶ', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      mockSavePrompts.mockRejectedValue(new Error('save error'))
      const { result } = renderHook(() => usePromptsPersistence())
      act(() => result.current.save([samplePrompt]))
      await vi.waitFor(() =>
        expect(consoleSpy).toHaveBeenCalledWith(
          '[usePromptsPersistence] save failed:',
          expect.any(Error)
        )
      )
      consoleSpy.mockRestore()
    })

    it('savePrompts が失敗してもクラッシュしない', async () => {
      mockSavePrompts.mockRejectedValue(new Error('save error'))
      const { result } = renderHook(() => usePromptsPersistence())
      expect(() => act(() => result.current.save([samplePrompt]))).not.toThrow()
    })
  })
})
