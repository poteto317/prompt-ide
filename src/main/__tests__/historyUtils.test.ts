import { describe, it, expect } from 'vitest'
import { isValidHistoryEntry, sanitizeHistoryEntry } from '../historyUtils'
import type { HistoryEntry } from '@shared/types'

const validEntry: HistoryEntry = {
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

describe('isValidHistoryEntry', () => {
  it('正しい形式は true', () => {
    expect(isValidHistoryEntry(validEntry)).toBe(true)
  })

  it('null / オブジェクトでない値は false', () => {
    expect(isValidHistoryEntry(null)).toBe(false)
    expect(isValidHistoryEntry('string')).toBe(false)
    expect(isValidHistoryEntry(123)).toBe(false)
  })

  it('id が string でない場合は false', () => {
    expect(isValidHistoryEntry({ ...validEntry, id: 1 })).toBe(false)
  })

  it('promptId が null または string 以外なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, promptId: 123 })).toBe(false)
    expect(isValidHistoryEntry({ ...validEntry, promptId: null })).toBe(true)
    expect(isValidHistoryEntry({ ...validEntry, promptId: 'p2' })).toBe(true)
  })

  it('未知の toolId は false', () => {
    expect(isValidHistoryEntry({ ...validEntry, toolId: 'unknown' })).toBe(false)
  })

  it('claude / copilot / api はすべて有効な toolId', () => {
    expect(isValidHistoryEntry({ ...validEntry, toolId: 'claude' })).toBe(true)
    expect(isValidHistoryEntry({ ...validEntry, toolId: 'copilot' })).toBe(true)
    expect(isValidHistoryEntry({ ...validEntry, toolId: 'api' })).toBe(true)
  })

  it('status が success / error 以外なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, status: 'pending' })).toBe(false)
  })

  it('resultText / errorMessage が null または string 以外なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, resultText: 123 })).toBe(false)
    expect(isValidHistoryEntry({ ...validEntry, errorMessage: 123 })).toBe(false)
  })

  it('fileContent が null または string 以外なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, fileContent: 123 })).toBe(false)
  })

  it('executedAt が number でない、または非有限値なら false', () => {
    expect(isValidHistoryEntry({ ...validEntry, executedAt: '1000' })).toBe(false)
    expect(isValidHistoryEntry({ ...validEntry, executedAt: NaN })).toBe(false)
    expect(isValidHistoryEntry({ ...validEntry, executedAt: Infinity })).toBe(false)
  })

  it('promptTitle が string でない場合は false', () => {
    expect(isValidHistoryEntry({ ...validEntry, promptTitle: 123 })).toBe(false)
  })

  it('promptContent が string でない場合は false', () => {
    expect(isValidHistoryEntry({ ...validEntry, promptContent: 123 })).toBe(false)
  })
})

describe('sanitizeHistoryEntry', () => {
  const entryWithFileContent: HistoryEntry = { ...validEntry, fileContent: 'ファイル内容' }

  it('既知のフィールドはそのまま保持する', () => {
    const result = sanitizeHistoryEntry(entryWithFileContent)
    expect(result).toEqual(entryWithFileContent)
  })

  it('余分なプロパティを除去する', () => {
    const withExtra = { ...validEntry, extra: 'x' } as HistoryEntry & { extra: string }
    const result = sanitizeHistoryEntry(withExtra)
    expect((result as Record<string, unknown>).extra).toBeUndefined()
    expect(result.id).toBe('h1')
  })

  it('promptId: null を保持する', () => {
    const entry = { ...validEntry, promptId: null }
    expect(sanitizeHistoryEntry(entry).promptId).toBeNull()
  })

  it('fileContent: null を保持する', () => {
    const entry = { ...validEntry, fileContent: null }
    expect(sanitizeHistoryEntry(entry).fileContent).toBeNull()
  })

  it('エラー時の resultText: null / errorMessage を保持する', () => {
    const entry: HistoryEntry = {
      ...validEntry,
      status: 'error',
      resultText: null,
      errorMessage: 'エラー内容'
    }
    const result = sanitizeHistoryEntry(entry)
    expect(result.resultText).toBeNull()
    expect(result.errorMessage).toBe('エラー内容')
  })
})
