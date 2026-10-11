import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') }
}))

vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile, mkdir: mockMkdir },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir
}))

import { loadHistory, saveHistory } from '../historyStore'
import type { HistoryEntry } from '@shared/types'

const sampleEntry: HistoryEntry = {
  id: 'h1',
  promptId: 'p1',
  promptTitle: 'タイトル',
  promptContent: 'プロンプト内容',
  fileContent: null,
  toolId: 'api',
  status: 'success',
  resultText: '結果テキスト',
  errorMessage: null,
  executedAt: 1000000,
  agent: null
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
})

describe('loadHistory', () => {
  it('ファイルが存在しない場合は空配列を返す', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)
    expect(await loadHistory()).toEqual([])
  })

  it('正常な JSON 配列を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify([sampleEntry]))
    expect(await loadHistory()).toEqual([sampleEntry])
  })

  it('JSON が配列でない場合は空配列を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ not: 'array' }))
    expect(await loadHistory()).toEqual([])
  })

  it('ENOENT 以外のエラーは伝播する', async () => {
    const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    mockReadFile.mockRejectedValue(err)
    await expect(loadHistory()).rejects.toThrow('EPERM')
  })

  it('正しいパスのファイルを読み込む', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)
    await loadHistory()
    expect(mockReadFile).toHaveBeenCalledWith('/mock/userData/history.json', 'utf-8')
  })

  describe('要素検証', () => {
    it('不正な toolId の要素を除外する', async () => {
      const invalid = { ...sampleEntry, id: 'h2', toolId: 'unknown' }
      mockReadFile.mockResolvedValue(JSON.stringify([sampleEntry, invalid]))
      const result = await loadHistory()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('h1')
    })

    it('不正な status の要素を除外する', async () => {
      const invalid = { ...sampleEntry, id: 'h2', status: 'pending' }
      mockReadFile.mockResolvedValue(JSON.stringify([invalid]))
      expect(await loadHistory()).toEqual([])
    })

    it('promptId: null を保持する', async () => {
      const nullPromptId = { ...sampleEntry, promptId: null }
      mockReadFile.mockResolvedValue(JSON.stringify([nullPromptId]))
      const result = await loadHistory()
      expect(result[0].promptId).toBeNull()
    })

    it('executedAt が number でない要素を除外する', async () => {
      const invalid = { ...sampleEntry, executedAt: '2024' }
      mockReadFile.mockResolvedValue(JSON.stringify([invalid]))
      expect(await loadHistory()).toEqual([])
    })

    it('余分なプロパティを除去する', async () => {
      const withExtra = { ...sampleEntry, extra: 'should be removed' }
      mockReadFile.mockResolvedValue(JSON.stringify([withExtra]))
      const result = await loadHistory()
      expect(result[0]).toEqual(sampleEntry)
      expect((result[0] as Record<string, unknown>)['extra']).toBeUndefined()
    })
  })
})

describe('saveHistory', () => {
  it('JSON 文字列化してファイルに書き込む', async () => {
    await saveHistory([sampleEntry])
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/userData/history.json',
      JSON.stringify([sampleEntry]),
      'utf-8'
    )
  })

  it('空配列を書き込める', async () => {
    await saveHistory([])
    expect(mockWriteFile).toHaveBeenCalledWith('/mock/userData/history.json', '[]', 'utf-8')
  })

  it('writeFile の前に userData ディレクトリを再帰的に作成する', async () => {
    await saveHistory([sampleEntry])
    expect(mockMkdir).toHaveBeenCalledWith('/mock/userData', { recursive: true })
  })
})
