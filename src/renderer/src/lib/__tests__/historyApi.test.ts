import { describe, it, expect, vi, beforeEach } from 'vitest'
import { loadHistory, saveHistory } from '../historyApi'
import type { HistoryEntry } from '../../types'

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
  window.api.loadHistory = vi.fn().mockResolvedValue([sampleEntry])
  window.api.saveHistory = vi.fn().mockResolvedValue(undefined)
})

describe('historyApi', () => {
  it('loadHistory は window.api.loadHistory に委譲する', async () => {
    const result = await loadHistory()
    expect(window.api.loadHistory).toHaveBeenCalledOnce()
    expect(result).toEqual([sampleEntry])
  })

  it('saveHistory は window.api.saveHistory に委譲する', async () => {
    await saveHistory([sampleEntry])
    expect(window.api.saveHistory).toHaveBeenCalledWith([sampleEntry])
  })
})
