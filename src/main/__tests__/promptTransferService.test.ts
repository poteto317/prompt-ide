import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Prompt } from '@shared/types'

const mockSaveJsonDialog = vi.hoisted(() => vi.fn())
const mockOpenJsonDialog = vi.hoisted(() => vi.fn())
const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())

vi.mock('../dialogService', () => ({
  saveJsonDialog: mockSaveJsonDialog,
  openJsonDialog: mockOpenJsonDialog,
}))

vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
}))

import { exportPromptsToFile, importPromptsFromFile } from '../promptTransferService'

const samplePrompt: Prompt = {
  id: 'p1',
  title: 'タイトル',
  content: 'コンテンツ',
  createdAt: 1000000,
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('exportPromptsToFile', () => {
  it('保存先が選ばれたとき writeFile にエンベロープ JSON を渡し true を返す', async () => {
    mockSaveJsonDialog.mockResolvedValue('/out/prompts.json')
    mockWriteFile.mockResolvedValue(undefined)

    const result = await exportPromptsToFile([samplePrompt])

    expect(mockSaveJsonDialog).toHaveBeenCalledWith('prompts.json')
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const [path, content, encoding] = mockWriteFile.mock.calls[0]
    expect(path).toBe('/out/prompts.json')
    expect(encoding).toBe('utf-8')
    const parsed = JSON.parse(content as string)
    expect(parsed.kind).toBe('prompt-ide/prompts')
    expect(parsed.prompts).toEqual([samplePrompt])
    expect(result).toBe(true)
  })

  it('ダイアログがキャンセルされたとき writeFile を呼ばず false を返す', async () => {
    mockSaveJsonDialog.mockResolvedValue(null)
    const result = await exportPromptsToFile([samplePrompt])
    expect(mockWriteFile).not.toHaveBeenCalled()
    expect(result).toBe(false)
  })
})

describe('importPromptsFromFile', () => {
  it('ファイルが選ばれたとき読み込んでパース結果を返す', async () => {
    mockOpenJsonDialog.mockResolvedValue('/in/prompts.json')
    mockReadFile.mockResolvedValue(JSON.stringify([samplePrompt]))

    const result = await importPromptsFromFile()

    expect(mockReadFile).toHaveBeenCalledWith('/in/prompts.json', 'utf-8')
    expect(result).toEqual([samplePrompt])
  })

  it('ダイアログがキャンセルされたとき readFile を呼ばず null を返す', async () => {
    mockOpenJsonDialog.mockResolvedValue(null)
    const result = await importPromptsFromFile()
    expect(mockReadFile).not.toHaveBeenCalled()
    expect(result).toBeNull()
  })

  it('壊れた JSON のとき空配列を返す', async () => {
    mockOpenJsonDialog.mockResolvedValue('/in/broken.json')
    mockReadFile.mockResolvedValue('{ broken')
    const result = await importPromptsFromFile()
    expect(result).toEqual([])
  })
})
