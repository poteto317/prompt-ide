import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prompt } from '@shared/types'

const mockHandle = vi.hoisted(() => vi.fn())
const mockLoadPrompts = vi.hoisted(() => vi.fn())
const mockSavePrompts = vi.hoisted(() => vi.fn())

vi.mock('../../promptStore', () => ({
  loadPrompts: mockLoadPrompts,
  savePrompts: mockSavePrompts,
}))

import { registerPromptsHandlers } from '../../handlers/promptsHandlers'

const mockIpcMain = { handle: mockHandle } as never

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(senderId: number) {
  return { sender: { id: senderId } }
}

const samplePrompt: Prompt = {
  id: 'p1',
  title: 'タイトル',
  content: 'コンテンツ',
  createdAt: 1000000,
}

beforeEach(() => {
  vi.clearAllMocks()
  registerPromptsHandlers(mockIpcMain)
})

describe('registerPromptsHandlers', () => {
  describe('prompts:load', () => {
    it('loadPrompts に委譲して配列を返す', async () => {
      mockLoadPrompts.mockResolvedValue([samplePrompt])
      const result = await getRegisteredHandler('prompts:load')(makeEvent(1))
      expect(mockLoadPrompts).toHaveBeenCalledOnce()
      expect(result).toEqual([samplePrompt])
    })

    it('空配列を返す場合も正しく返す', async () => {
      mockLoadPrompts.mockResolvedValue([])
      const result = await getRegisteredHandler('prompts:load')(makeEvent(1))
      expect(result).toEqual([])
    })
  })

  describe('prompts:save', () => {
    it('プロンプト配列を savePrompts に渡す', async () => {
      mockSavePrompts.mockResolvedValue(undefined)
      await getRegisteredHandler('prompts:save')(makeEvent(1), [samplePrompt])
      expect(mockSavePrompts).toHaveBeenCalledWith([samplePrompt])
    })

    it('空配列を savePrompts に渡せる', async () => {
      mockSavePrompts.mockResolvedValue(undefined)
      await getRegisteredHandler('prompts:save')(makeEvent(1), [])
      expect(mockSavePrompts).toHaveBeenCalledWith([])
    })

    it('payload が配列でないとき "引数は配列である必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('prompts:save')(makeEvent(1), { not: 'array' })
      ).rejects.toThrow('引数は配列である必要があります')
      expect(mockSavePrompts).not.toHaveBeenCalled()
    })

    it('payload が null のとき "引数は配列である必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('prompts:save')(makeEvent(1), null)
      ).rejects.toThrow('引数は配列である必要があります')
    })
  })
})
