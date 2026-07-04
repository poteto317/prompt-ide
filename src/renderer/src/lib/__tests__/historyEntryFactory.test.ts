import { describe, it, expect } from 'vitest'
import type { HistoryEntry } from '../../types'
import { createHistoryEntry } from '../historyEntryFactory'

const base: Omit<HistoryEntry, 'id'> = {
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

describe('createHistoryEntry', () => {
  it('id が採番される', () => {
    const entry = createHistoryEntry(base)
    expect(typeof entry.id).toBe('string')
    expect(entry.id.length).toBeGreaterThan(0)
  })

  it('渡したフィールドがそのまま保持される', () => {
    const entry = createHistoryEntry(base)
    expect(entry).toMatchObject(base)
  })

  it('連続で呼び出しても id が重複しない', () => {
    const first = createHistoryEntry(base)
    const second = createHistoryEntry(base)
    expect(first.id).not.toBe(second.id)
  })
})
