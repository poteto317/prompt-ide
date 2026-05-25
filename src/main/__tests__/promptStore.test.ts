import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
}))

vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile, mkdir: mockMkdir },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
}))

import { loadPrompts, savePrompts } from '../promptStore'
import type { Prompt } from '@shared/types'

const samplePrompt: Prompt = {
  id: 'p1',
  title: 'タイトル',
  content: 'コンテンツ',
  createdAt: 1000000,
}

beforeEach(() => {
  vi.clearAllMocks()
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
})

describe('loadPrompts', () => {
  it('ファイルが存在しない場合は空配列を返す', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)
    expect(await loadPrompts()).toEqual([])
  })

  it('正常な JSON 配列を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify([samplePrompt]))
    const result = await loadPrompts()
    expect(result).toEqual([samplePrompt])
  })

  it('JSON が配列でない場合は空配列を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ not: 'array' }))
    expect(await loadPrompts()).toEqual([])
  })

  it('ENOENT 以外のエラーは伝播する', async () => {
    const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    mockReadFile.mockRejectedValue(err)
    await expect(loadPrompts()).rejects.toThrow('EPERM')
  })

  it('正しいパスのファイルを読み込む', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)
    await loadPrompts()
    expect(mockReadFile).toHaveBeenCalledWith('/mock/userData/prompts.json', 'utf-8')
  })

  describe('要素検証', () => {
    it('id が string でない要素を除外する', async () => {
      const invalid = { id: 123, title: 'T', content: 'C', createdAt: 1 }
      mockReadFile.mockResolvedValue(JSON.stringify([samplePrompt, invalid]))
      const result = await loadPrompts()
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(samplePrompt)
    })

    it('title が欠落している要素を除外する', async () => {
      const invalid = { id: 'p2', content: 'C', createdAt: 1 }
      mockReadFile.mockResolvedValue(JSON.stringify([samplePrompt, invalid]))
      const result = await loadPrompts()
      expect(result).toHaveLength(1)
    })

    it('createdAt が number でない要素を除外する', async () => {
      const invalid = { id: 'p2', title: 'T', content: 'C', createdAt: '2024' }
      mockReadFile.mockResolvedValue(JSON.stringify([invalid]))
      expect(await loadPrompts()).toEqual([])
    })

    it('null 要素を除外する', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify([null, samplePrompt]))
      const result = await loadPrompts()
      expect(result).toHaveLength(1)
      expect(result[0]).toEqual(samplePrompt)
    })

    it('余分なプロパティを除去する', async () => {
      const withExtra = { ...samplePrompt, extra: 'should be removed' }
      mockReadFile.mockResolvedValue(JSON.stringify([withExtra]))
      const result = await loadPrompts()
      expect(result[0]).toEqual(samplePrompt)
      expect((result[0] as Record<string, unknown>)['extra']).toBeUndefined()
    })

    it('有効な要素のみを返し無効な要素を除外する', async () => {
      const invalid = { id: 999, title: 'bad', content: 'C', createdAt: 1 }
      mockReadFile.mockResolvedValue(JSON.stringify([samplePrompt, invalid]))
      const result = await loadPrompts()
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe('p1')
    })
  })
})

describe('savePrompts', () => {
  it('JSON 文字列化してファイルに書き込む', async () => {
    await savePrompts([samplePrompt])
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/userData/prompts.json',
      JSON.stringify([samplePrompt]),
      'utf-8'
    )
  })

  it('空配列を書き込める', async () => {
    await savePrompts([])
    expect(mockWriteFile).toHaveBeenCalledWith('/mock/userData/prompts.json', '[]', 'utf-8')
  })

  it('writeFile の前に userData ディレクトリを再帰的に作成する', async () => {
    await savePrompts([samplePrompt])
    expect(mockMkdir).toHaveBeenCalledWith('/mock/userData', { recursive: true })
  })

  it('mkdir は writeFile より先に呼ばれる', async () => {
    await savePrompts([samplePrompt])
    const mkdirOrder = mockMkdir.mock.invocationCallOrder[0]
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0]
    expect(mkdirOrder).toBeLessThan(writeOrder)
  })

  describe('書き込みキュー（直列化）', () => {
    it('連続した save は呼び出し順に書き込まれる', async () => {
      const invocationOrder: string[] = []
      mockWriteFile.mockImplementation((_path: string, content: string) => {
        invocationOrder.push(content)
        return Promise.resolve()
      })

      await Promise.all([savePrompts([samplePrompt]), savePrompts([])])

      expect(invocationOrder).toHaveLength(2)
      expect(invocationOrder[0]).toBe(JSON.stringify([samplePrompt]))
      expect(invocationOrder[1]).toBe('[]')
    })

    it('先行 save が完了するまで後続 save の writeFile は呼ばれない', async () => {
      let resolveFirst!: () => void
      mockWriteFile
        .mockImplementationOnce(
          () => new Promise<void>((resolve) => { resolveFirst = resolve })
        )
        .mockResolvedValue(undefined)

      const p1 = savePrompts([samplePrompt])
      const p2 = savePrompts([])

      // 最初の writeFile が呼ばれるまで待つ（mkdir 完了後に呼ばれる）
      await vi.waitFor(() => expect(mockWriteFile).toHaveBeenCalledTimes(1))
      // この時点で 2番目の writeFile はまだ呼ばれていない
      expect(mockWriteFile.mock.calls[0][1]).toBe(JSON.stringify([samplePrompt]))

      resolveFirst()
      await Promise.all([p1, p2])

      expect(mockWriteFile).toHaveBeenCalledTimes(2)
      expect(mockWriteFile.mock.calls[1][1]).toBe('[]')
    })
  })
})
