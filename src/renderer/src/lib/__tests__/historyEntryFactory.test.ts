import { describe, it, expect } from 'vitest'
import type { HistoryEntry } from '../../types'
import { buildAgentSentHistoryEntry, createHistoryEntry } from '../historyEntryFactory'

const base: Omit<HistoryEntry, 'id'> = {
  promptId: 'p1',
  promptTitle: 'タイトル',
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'api',
  status: 'success',
  resultText: '結果',
  errorMessage: null,
  executedAt: 1000,
  agent: null
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

describe('buildAgentSentHistoryEntry', () => {
  const sent = {
    claudeSessionId: '11111111-1111-4111-8111-111111111111',
    tabLabel: 'claude 2',
    folderPath: '/work/project'
  }

  it('送った全文と送り先を、結果を持たない sent のエントリにする', () => {
    expect(
      buildAgentSentHistoryEntry({ promptId: 'p1', promptTitle: 'タイトル' }, '全文', sent, 1234)
    ).toEqual({
      promptId: 'p1',
      promptTitle: 'タイトル',
      promptContent: '全文',
      fileContent: null,
      toolId: 'claude',
      status: 'sent',
      resultText: null,
      errorMessage: null,
      executedAt: 1234,
      agent: sent
    })
  })

  it('context の余分なフィールドはエントリに写さない', () => {
    const context = { promptId: null, promptTitle: '無題', extra: 'x' }
    const entry = buildAgentSentHistoryEntry(context, '全文', sent, 1)
    expect(entry).not.toHaveProperty('extra')
    expect(entry.promptId).toBeNull()
  })
})
