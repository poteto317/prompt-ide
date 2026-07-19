import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn())
const mockChmod = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') }
}))

vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile, mkdir: mockMkdir, chmod: mockChmod },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  chmod: mockChmod
}))

import { readSettingsFile, writeSettingsFile } from '../settingsFileStore'

beforeEach(() => {
  vi.clearAllMocks()
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
  mockChmod.mockResolvedValue(undefined)
})

describe('readSettingsFile', () => {
  it('ファイルが存在しない場合は空オブジェクトを返す', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    expect(await readSettingsFile()).toEqual({})
  })

  it('ENOENT 以外のエラーは伝播する', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    await expect(readSettingsFile()).rejects.toThrow('EPERM')
  })

  it('不正な JSON のときパースエラーが伝播する', async () => {
    mockReadFile.mockResolvedValue('not json{{')
    await expect(readSettingsFile()).rejects.toThrow()
  })

  it('正しいパスのファイルを utf-8 で読み込む', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await readSettingsFile()
    expect(mockReadFile).toHaveBeenCalledWith('/mock/userData/settings.json', 'utf-8')
  })

  it('保存済みの内容をそのまま返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ modelId: 'claude-opus-4-8', maxTokens: 8000 }))
    expect(await readSettingsFile()).toEqual({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
  })
})

describe('writeSettingsFile', () => {
  it('既存内容が無いときは partial の内容だけを書き込む', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await writeSettingsFile({ modelId: 'claude-opus-4-8' })
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written).toEqual({ modelId: 'claude-opus-4-8' })
  })

  it('既存フィールドを保持したまま merge 書き込みする', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ encryptedApiKey: 'abc', maxTokens: 4096 }))
    await writeSettingsFile({ modelId: 'claude-opus-4-8' })
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written).toEqual({
      encryptedApiKey: 'abc',
      maxTokens: 4096,
      modelId: 'claude-opus-4-8'
    })
  })

  it('undefined を指定したキーは書き込み結果から削除される', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ apiKey: 'legacy', encryptedApiKey: 'enc' }))
    await writeSettingsFile({ apiKey: undefined })
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written).not.toHaveProperty('apiKey')
    expect(written.encryptedApiKey).toBe('enc')
  })

  it('userData ディレクトリを再帰的に作成する', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await writeSettingsFile({ modelId: 'claude-opus-4-8' })
    expect(mockMkdir).toHaveBeenCalledWith('/mock/userData', { recursive: true })
  })

  it('writeFile を mode 0o600 で呼ぶ', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await writeSettingsFile({ modelId: 'claude-opus-4-8' })
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/userData/settings.json',
      expect.any(String),
      { encoding: 'utf-8', mode: 0o600 }
    )
  })

  it('writeFile 後に chmod(0o600) を呼ぶ(既存ファイルの権限も確実に設定する)', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await writeSettingsFile({ modelId: 'claude-opus-4-8' })
    expect(mockChmod).toHaveBeenCalledWith('/mock/userData/settings.json', 0o600)
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0]
    const chmodOrder = mockChmod.mock.invocationCallOrder[0]
    expect(chmodOrder).toBeGreaterThan(writeOrder)
  })

  it('並行して呼ばれても書き込みが直列化され、後勝ちが先勝ちの変更を消さない(lost update防止)', async () => {
    // read-modify-write を模した簡易フェイクストア。writeFile が呼ばれるたびに
    // 状態を更新し、以降の readFile はその最新状態を返す
    let fakeStore: Record<string, unknown> | null = null
    mockReadFile.mockImplementation(() =>
      fakeStore === null
        ? Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        : Promise.resolve(JSON.stringify(fakeStore))
    )
    mockWriteFile.mockImplementation((_path: string, content: string) => {
      fakeStore = JSON.parse(content)
      return Promise.resolve(undefined)
    })

    // 直列化されていなければ、両方が書き込み前の古い状態を読み込み、
    // 後勝ちの writeFile が先勝ちの変更フィールドを消してしまう
    await Promise.all([
      writeSettingsFile({ encryptedApiKey: 'enc-key' }),
      writeSettingsFile({ modelId: 'claude-opus-4-8' })
    ])

    expect(fakeStore).toEqual({ encryptedApiKey: 'enc-key', modelId: 'claude-opus-4-8' })
  })

  it('先行する write が失敗しても後続の write はブロックされない', async () => {
    mockReadFile.mockRejectedValueOnce(new Error('unexpected read error'))
    mockReadFile.mockResolvedValue(JSON.stringify({}))

    await expect(writeSettingsFile({ modelId: 'claude-opus-4-8' })).rejects.toThrow(
      'unexpected read error'
    )
    await expect(writeSettingsFile({ maxTokens: 4096 })).resolves.toBeUndefined()
  })
})
