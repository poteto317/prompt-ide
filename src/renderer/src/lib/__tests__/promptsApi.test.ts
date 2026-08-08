import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prompt } from '../../types'
import { loadPrompts, savePrompts, exportPrompts, importPrompts } from '../promptsApi'

const samplePrompt: Prompt = {
  id: 'p1',
  title: 'タイトル',
  content: 'コンテンツ',
  createdAt: 1000000
}

const mockApi = {
  loadPrompts: vi.fn(),
  savePrompts: vi.fn(),
  exportPrompts: vi.fn(),
  importPrompts: vi.fn()
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

describe('exportPrompts', () => {
  it('window.api.exportPrompts にプロンプト配列を渡し、成功可否を返す', async () => {
    mockApi.exportPrompts.mockResolvedValue(true)
    const result = await exportPrompts([samplePrompt])
    expect(mockApi.exportPrompts).toHaveBeenCalledWith([samplePrompt])
    expect(result).toBe(true)
  })

  it('キャンセル時は false を返す', async () => {
    mockApi.exportPrompts.mockResolvedValue(false)
    const result = await exportPrompts([samplePrompt])
    expect(result).toBe(false)
  })
})

describe('importPrompts', () => {
  it('window.api.importPrompts を呼び出してプロンプト配列を返す', async () => {
    mockApi.importPrompts.mockResolvedValue([samplePrompt])
    const result = await importPrompts()
    expect(mockApi.importPrompts).toHaveBeenCalledOnce()
    expect(result).toEqual([samplePrompt])
  })

  it('キャンセル時は null を返す', async () => {
    mockApi.importPrompts.mockResolvedValue(null)
    const result = await importPrompts()
    expect(result).toBeNull()
  })
})
