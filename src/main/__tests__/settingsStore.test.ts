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

import { getApiKey, setApiKey } from '../settingsStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
})

describe('getApiKey', () => {
  it('ファイルが存在しない場合は空文字を返す', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    expect(await getApiKey()).toBe('')
  })

  it('ファイルに apiKey が保存されている場合はその値を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ apiKey: 'sk-ant-test' }))
    expect(await getApiKey()).toBe('sk-ant-test')
  })

  it('ファイルに apiKey が含まれていない場合は空文字を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}))
    expect(await getApiKey()).toBe('')
  })

  it('正しいパスのファイルを読み込む', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))
    await getApiKey()
    expect(mockReadFile).toHaveBeenCalledWith('/mock/userData/settings.json', 'utf-8')
  })
})

describe('setApiKey', () => {
  it('設定ファイルに apiKey を書き込む', async () => {
    await setApiKey('sk-ant-abc')
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/userData/settings.json',
      JSON.stringify({ apiKey: 'sk-ant-abc' }, null, 2),
      'utf-8'
    )
  })

  it('userData ディレクトリを再帰的に作成する', async () => {
    await setApiKey('sk-ant-abc')
    expect(mockMkdir).toHaveBeenCalledWith('/mock/userData', { recursive: true })
  })
})
