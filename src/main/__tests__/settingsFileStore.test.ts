import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn())
const mockChmod = vi.hoisted(() => vi.fn())
const mockRename = vi.hoisted(() => vi.fn())
const mockRm = vi.hoisted(() => vi.fn())
const mockOpen = vi.hoisted(() => vi.fn())
const mockLstat = vi.hoisted(() => vi.fn())
const mockRealpath = vi.hoisted(() => vi.fn())
const mockSync = vi.hoisted(() => vi.fn())
const mockClose = vi.hoisted(() => vi.fn())

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

import { readSettingsFile, writeSettingsFile } from '../settingsFileStore'

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
  mockSync.mockResolvedValue(undefined)
  mockClose.mockResolvedValue(undefined)
  mockOpen.mockResolvedValue({ sync: mockSync, close: mockClose })
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

  it('使うエージェント CLI を書いても、API キーの暗号文・実行方式を残す', async () => {
    mockReadFile.mockResolvedValue(
      JSON.stringify({ encryptedApiKey: 'abc', promptExecutionMode: 'agent-cli' })
    )
    await writeSettingsFile({ agentCliKind: 'copilot' })
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written).toEqual({
      encryptedApiKey: 'abc',
      promptExecutionMode: 'agent-cli',
      agentCliKind: 'copilot'
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

  it('同じディレクトリの一時ファイル(pid と乱数入り)へ mode 0o600 で書き、settings.json へ rename する', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await writeSettingsFile({ modelId: 'claude-opus-4-8' })
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/mock\/userData\/settings\.json\.\d+\.[0-9a-f]{12}\.tmp$/),
      expect.any(String),
      {
        encoding: 'utf-8',
        mode: 0o600,
        flag: 'wx'
      }
    )
    const tempPath = mockWriteFile.mock.calls[0][0] as string
    expect(tempPath).toContain(`.${process.pid}.`)
    expect(mockRename).toHaveBeenCalledWith(tempPath, '/mock/userData/settings.json')
  })

  it('一時ファイルの writeFile 後、rename の前に chmod(0o600) を呼ぶ(置き換え後の権限も 0o600 にする)', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await writeSettingsFile({ modelId: 'claude-opus-4-8' })
    expect(mockChmod).toHaveBeenCalledWith(mockWriteFile.mock.calls[0][0], 0o600)
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0]
    const chmodOrder = mockChmod.mock.invocationCallOrder[0]
    const renameOrder = mockRename.mock.invocationCallOrder[0]
    expect(chmodOrder).toBeGreaterThan(writeOrder)
    expect(renameOrder).toBeGreaterThan(chmodOrder)
  })

  it('一時ファイルを r+ で開いて sync してから閉じ、そのあとで rename する(電源断で 0 バイトの settings.json を残さない)', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    await writeSettingsFile({ modelId: 'claude-opus-4-8' })
    const tempPath = mockWriteFile.mock.calls[0][0] as string
    expect(mockOpen).toHaveBeenCalledWith(tempPath, 'r+')
    expect(mockSync).toHaveBeenCalledTimes(1)
    expect(mockClose).toHaveBeenCalledTimes(1)
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0]
    const syncOrder = mockSync.mock.invocationCallOrder[0]
    const closeOrder = mockClose.mock.invocationCallOrder[0]
    const renameOrder = mockRename.mock.invocationCallOrder[0]
    expect(syncOrder).toBeGreaterThan(writeOrder)
    expect(closeOrder).toBeGreaterThan(syncOrder)
    expect(renameOrder).toBeGreaterThan(closeOrder)
  })

  it('sync が失敗しても fd を閉じ、一時ファイルを消して失敗を返す(rename しない)', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    mockSync.mockRejectedValueOnce(Object.assign(new Error('EIO: sync failed'), { code: 'EIO' }))
    await expect(writeSettingsFile({ modelId: 'claude-opus-4-8' })).rejects.toThrow('EIO')
    expect(mockClose).toHaveBeenCalledTimes(1)
    expect(mockRename).not.toHaveBeenCalled()
    expect(mockRm).toHaveBeenCalledWith(mockWriteFile.mock.calls[0][0], { force: true })
  })

  it('一時ファイルの後始末が失敗したら console.error に記録し、元の例外を返す', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      const renameErr = Object.assign(new Error('EPERM: rename failed'), { code: 'EPERM' })
      const rmErr = Object.assign(new Error('EBUSY: rm failed'), { code: 'EBUSY' })
      mockRename.mockRejectedValueOnce(renameErr)
      mockRm.mockRejectedValueOnce(rmErr)
      await expect(writeSettingsFile({ modelId: 'claude-opus-4-8' })).rejects.toBe(renameErr)
      expect(consoleError).toHaveBeenCalledWith(
        '[settingsFileStore] failed to remove temp file:',
        rmErr
      )
    } finally {
      consoleError.mockRestore()
    }
  })

  it('rename が失敗したら一時ファイルを消して失敗を返す', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    mockRename.mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
    await expect(writeSettingsFile({ modelId: 'claude-opus-4-8' })).rejects.toThrow('EPERM')
    expect(mockRm).toHaveBeenCalledWith(mockWriteFile.mock.calls[0][0], { force: true })
  })

  it('並行して呼ばれても書き込みが直列化され、後勝ちが先勝ちの変更を消さない(lost update防止)', async () => {
    // read-modify-write を模した簡易フェイクストア。一時ファイルへの writeFile の内容を
    // rename で確定し、以降の readFile はその最新状態を返す
    let fakeStore: Record<string, unknown> | null = null
    const pendingWrites = new Map<string, string>()
    mockReadFile.mockImplementation(() =>
      fakeStore === null
        ? Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
        : Promise.resolve(JSON.stringify(fakeStore))
    )
    mockWriteFile.mockImplementation((tempFile: string, content: string) => {
      pendingWrites.set(tempFile, content)
      return Promise.resolve(undefined)
    })
    mockRename.mockImplementation((from: string) => {
      fakeStore = JSON.parse(pendingWrites.get(from) ?? 'null')
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
