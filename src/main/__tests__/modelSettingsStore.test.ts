import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn())
const mockChmod = vi.hoisted(() => vi.fn())
const mockRename = vi.hoisted(() => vi.fn())
const mockRm = vi.hoisted(() => vi.fn())
// 一時ファイルを rename の前に sync するため、open は sync と close だけを持つ偽の FileHandle を返す
const mockOpen = vi.hoisted(() => vi.fn())
const mockLstat = vi.hoisted(() => vi.fn())
const mockRealpath = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') }
}))

vi.mock('node:fs/promises', () => ({
  default: {
    readFile: mockReadFile,
    writeFile: mockWriteFile,
    mkdir: mockMkdir,
    chmod: mockChmod,
    rename: mockRename,
    rm: mockRm,
    open: mockOpen,
    lstat: mockLstat,
    realpath: mockRealpath
  },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  chmod: mockChmod,
  rename: mockRename,
  rm: mockRm,
  open: mockOpen,
  lstat: mockLstat,
  realpath: mockRealpath
}))

import { getModelSettings, setModelSettings } from '../modelSettingsStore'
import { SettingsFileError } from '../settingsFileStore'

beforeEach(() => {
  vi.clearAllMocks()
  // 書き込み先はシンボリックリンクではない(lstat は通常のファイルを返し、realpath は呼ばれない)
  mockLstat.mockResolvedValue({ isSymbolicLink: () => false })
  mockRealpath.mockImplementation(async (target: string) => target)
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
  mockChmod.mockResolvedValue(undefined)
  mockRename.mockResolvedValue(undefined)
  mockRm.mockResolvedValue(undefined)
  mockOpen.mockResolvedValue({
    sync: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined)
  })
  // merge 書き込みのため書き込み系も readFile を呼ぶ。デフォルトは「ファイルなし」
  mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
})

describe('getModelSettings', () => {
  it('ファイルが存在しない場合はデフォルト値を返す', async () => {
    const result = await getModelSettings()
    expect(result).toEqual({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
  })

  it('保存済みの有効な設定を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ modelId: 'claude-opus-4-8', maxTokens: 8000 }))
    const result = await getModelSettings()
    expect(result).toEqual({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
  })

  it('未知の modelId の場合はデフォルト値にフォールバックする', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ modelId: 'unknown-model', maxTokens: 8000 }))
    const result = await getModelSettings()
    expect(result).toEqual({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
  })

  it('maxTokens がモデルの上限を超える場合はデフォルト値にフォールバックする', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ modelId: 'claude-haiku-4-5', maxTokens: 999999 })
    )
    const result = await getModelSettings()
    expect(result).toEqual({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
  })

  it('maxTokens が整数でない場合はデフォルト値にフォールバックする', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ modelId: 'claude-haiku-4-5', maxTokens: 1.5 }))
    const result = await getModelSettings()
    expect(result).toEqual({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
  })

  it.each<[string, Record<string, unknown>]>([
    ['maxTokens が数字の文字列', { modelId: 'claude-opus-4-8', maxTokens: '8000' }],
    ['maxTokens が 0', { modelId: 'claude-opus-4-8', maxTokens: 0 }],
    ['maxTokens が負数', { modelId: 'claude-opus-4-8', maxTokens: -1 }],
    ['maxTokens が null', { modelId: 'claude-opus-4-8', maxTokens: null }],
    ['maxTokens が無い', { modelId: 'claude-opus-4-8' }],
    ['modelId が文字列でない', { modelId: 1, maxTokens: 8000 }],
    ['modelId が無い', { maxTokens: 8000 }]
  ])('保存値が不正(%s)ならデフォルト値にフォールバックする', async (_label, saved) => {
    mockReadFile.mockResolvedValue(JSON.stringify(saved))
    await expect(getModelSettings()).resolves.toEqual({
      modelId: 'claude-haiku-4-5',
      maxTokens: 4096
    })
  })

  it.each([1, 64000])('maxTokens が境界値(%i)ならそのまま返す', async (maxTokens) => {
    mockReadFile.mockResolvedValue(JSON.stringify({ modelId: 'claude-haiku-4-5', maxTokens }))
    await expect(getModelSettings()).resolves.toEqual({ modelId: 'claude-haiku-4-5', maxTokens })
  })

  it('settings.json が壊れていれば、デフォルト値に流さずに SettingsFileError で失敗する', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockReadFile.mockResolvedValue('{ broken')
      await expect(getModelSettings()).rejects.toBeInstanceOf(SettingsFileError)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})

describe('setModelSettings', () => {
  it('有効な設定を merge 書き込みする', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ encryptedApiKey: 'abc' }))
    await setModelSettings({ modelId: 'claude-sonnet-5', maxTokens: 8192 })
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.modelId).toBe('claude-sonnet-5')
    expect(written.maxTokens).toBe(8192)
    expect(written.encryptedApiKey).toBe('abc')
  })

  it('不明な modelId の場合はエラーを投げる', async () => {
    await expect(
      setModelSettings({ modelId: 'unknown-model' as never, maxTokens: 1000 })
    ).rejects.toThrow('不明なモデルです')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('maxTokens がモデルの上限を超える場合はエラーを投げる', async () => {
    await expect(
      setModelSettings({ modelId: 'claude-haiku-4-5', maxTokens: 999999 })
    ).rejects.toThrow('max_tokens は 1〜64000 の整数である必要があります')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('maxTokens が 0 以下の場合はエラーを投げる', async () => {
    await expect(setModelSettings({ modelId: 'claude-haiku-4-5', maxTokens: 0 })).rejects.toThrow(
      'max_tokens は 1〜64000 の整数である必要があります'
    )
  })

  it.each([1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'maxTokens が整数でない(%s)場合はエラーを投げ、書き込まない',
    async (maxTokens) => {
      await expect(setModelSettings({ modelId: 'claude-haiku-4-5', maxTokens })).rejects.toThrow(
        'max_tokens は 1〜64000 の整数である必要があります'
      )
      expect(mockWriteFile).not.toHaveBeenCalled()
    }
  )

  it.each([1, 64000])('maxTokens が境界値(%i)なら書き込む', async (maxTokens) => {
    await setModelSettings({ modelId: 'claude-haiku-4-5', maxTokens })
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.maxTokens).toBe(maxTokens)
  })
})
