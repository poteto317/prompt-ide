import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prompt } from '../../types'
import { loadPrompts, savePrompts } from '../promptsApi'

const samplePrompt: Prompt = {
  id: 'p1',
  title: 'タイトル',
  content: 'コンテンツ',
  createdAt: 1000000,
}

const mockApi = {
  loadPrompts: vi.fn(),
  savePrompts: vi.fn(),
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('loadPrompts', () => {
  it('window.api.loadPrompts を呼び出して配列を返す', async () => {
    mockApi.loadPrompts.mockResolvedValue([samplePrompt])
    const result = await loadPrompts()
    expect(mockApi.loadPrompts).toHaveBeenCalledOnce()
    expect(result).toEqual([samplePrompt])
  })

  it('空配列を返す場合も正しく返す', async () => {
    mockApi.loadPrompts.mockResolvedValue([])
    const result = await loadPrompts()
    expect(result).toEqual([])
  })
})

describe('savePrompts', () => {
  it('window.api.savePrompts にプロンプト配列を渡して呼び出す', async () => {
    mockApi.savePrompts.mockResolvedValue(undefined)
    await savePrompts([samplePrompt])
    expect(mockApi.savePrompts).toHaveBeenCalledWith([samplePrompt])
  })

  it('空配列を渡しても呼び出せる', async () => {
    mockApi.savePrompts.mockResolvedValue(undefined)
    await savePrompts([])
    expect(mockApi.savePrompts).toHaveBeenCalledWith([])
  })
})
