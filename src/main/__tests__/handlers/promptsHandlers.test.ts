import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prompt } from '@shared/types'

const mockHandle = vi.hoisted(() => vi.fn())
const mockLoadPrompts = vi.hoisted(() => vi.fn())
const mockSavePrompts = vi.hoisted(() => vi.fn())
const mockExportPromptsToFile = vi.hoisted(() => vi.fn())
const mockImportPromptsFromFile = vi.hoisted(() => vi.fn())

vi.mock('../../promptStore', () => ({
  loadPrompts: mockLoadPrompts,
  savePrompts: mockSavePrompts,
}))

vi.mock('../../promptTransferService', () => ({
  exportPromptsToFile: mockExportPromptsToFile,
  importPromptsFromFile: mockImportPromptsFromFile,
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

    it('id が string でない要素があると "プロンプトの形式が不正です" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('prompts:save')(makeEvent(1), [
          { id: 123, title: 'T', content: 'C', createdAt: 1 },
        ])
      ).rejects.toThrow('プロンプトの形式が不正です')
      expect(mockSavePrompts).not.toHaveBeenCalled()
    })

    it('title が欠落している要素があると "プロンプトの形式が不正です" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('prompts:save')(makeEvent(1), [
          { id: 'p1', content: 'C', createdAt: 1 },
        ])
      ).rejects.toThrow('プロンプトの形式が不正です')
    })

    it('createdAt が number でない要素があると "プロンプトの形式が不正です" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('prompts:save')(makeEvent(1), [
          { id: 'p1', title: 'T', content: 'C', createdAt: '2024' },
        ])
      ).rejects.toThrow('プロンプトの形式が不正です')
    })

    it('余分なプロパティは除去されて savePrompts に渡される', async () => {
      mockSavePrompts.mockResolvedValue(undefined)
      const withExtra = { ...samplePrompt, extra: 'should be removed' }
      await getRegisteredHandler('prompts:save')(makeEvent(1), [withExtra])
      expect(mockSavePrompts).toHaveBeenCalledWith([samplePrompt])
    })

    it('配列内の null 要素があると "プロンプトの形式が不正です" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('prompts:save')(makeEvent(1), [null])
      ).rejects.toThrow('プロンプトの形式が不正です')
    })
  })

  describe('prompts:export', () => {
    it('検証済みの配列を exportPromptsToFile に渡し、その戻り値を返す', async () => {
      mockExportPromptsToFile.mockResolvedValue(true)
      const result = await getRegisteredHandler('prompts:export')(makeEvent(1), [samplePrompt])
      expect(mockExportPromptsToFile).toHaveBeenCalledWith([samplePrompt])
      expect(result).toBe(true)
    })

    it('サービスが false を返した場合はそのまま false を返す', async () => {
      mockExportPromptsToFile.mockResolvedValue(false)
      const result = await getRegisteredHandler('prompts:export')(makeEvent(1), [samplePrompt])
      expect(result).toBe(false)
    })

    it('余分なプロパティは除去して exportPromptsToFile に渡される', async () => {
      mockExportPromptsToFile.mockResolvedValue(true)
      const withExtra = { ...samplePrompt, extra: 'remove me' }
      await getRegisteredHandler('prompts:export')(makeEvent(1), [withExtra])
      expect(mockExportPromptsToFile).toHaveBeenCalledWith([samplePrompt])
    })

    it('payload が配列でないとき "引数は配列である必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('prompts:export')(makeEvent(1), { not: 'array' })
      ).rejects.toThrow('引数は配列である必要があります')
      expect(mockExportPromptsToFile).not.toHaveBeenCalled()
    })

    it('不正なプロンプトを含むとき "プロンプトの形式が不正です" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('prompts:export')(makeEvent(1), [{ id: 123 }])
      ).rejects.toThrow('プロンプトの形式が不正です')
      expect(mockExportPromptsToFile).not.toHaveBeenCalled()
    })
  })

  describe('prompts:import', () => {
    it('importPromptsFromFile の戻り値（Prompt 配列）をそのまま返す', async () => {
      mockImportPromptsFromFile.mockResolvedValue([samplePrompt])
      const result = await getRegisteredHandler('prompts:import')(makeEvent(1))
      expect(mockImportPromptsFromFile).toHaveBeenCalledOnce()
      expect(result).toEqual([samplePrompt])
    })

    it('importPromptsFromFile が null（キャンセル）を返した場合は null を返す', async () => {
      mockImportPromptsFromFile.mockResolvedValue(null)
      const result = await getRegisteredHandler('prompts:import')(makeEvent(1))
      expect(result).toBeNull()
    })
  })
})
