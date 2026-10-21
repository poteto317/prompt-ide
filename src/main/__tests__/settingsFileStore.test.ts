import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

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

import { SETTINGS_FILE_ERROR_REASON } from '@shared/settingsFileMessages'
import { readSettingsFile, writeSettingsFile, SettingsFileError } from '../settingsFileStore'

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

  describe('読み込みの失敗(L-017)', () => {
    // 中身の断片(API キーの暗号文を含みうる)とパスを画面へ出さないよう、固定の文言の SettingsFileError で投げ直す
    const SECRET_CONTENT = 'djEwSECRET{'
    const SETTINGS_PATH = '/mock/userData/settings.json'
    let consoleErrorSpy: MockInstance<typeof console.error> | null = null

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy?.mockRestore()
      consoleErrorSpy = null
    })

    async function readFailure(): Promise<unknown> {
      return readSettingsFile().then(
        () => {
          throw new Error('readSettingsFile は失敗するはず')
        },
        (err: unknown) => err
      )
    }

    function expectFixedSettingsFileError(err: unknown): void {
      expect(err).toBeInstanceOf(SettingsFileError)
      const error = err as SettingsFileError
      expect(error.name).toBe('SettingsFileError')
      expect(error.message).toBe(SETTINGS_FILE_ERROR_REASON)
      expect(String(error)).not.toContain(SECRET_CONTENT)
      expect(String(error)).not.toContain(SETTINGS_PATH)
    }

    it('壊れた JSON は固定の文言の SettingsFileError になり、中身もパスも含まず、元の例外を console.error に記録する', async () => {
      mockReadFile.mockResolvedValue(SECRET_CONTENT)
      const err = await readFailure()
      expectFixedSettingsFileError(err)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[settingsFileStore] failed to read settings file:',
        expect.any(SyntaxError)
      )
    })

    it('読み込めない(EPERM)ときも固定の文言の SettingsFileError になり、パスを含まず、元の例外を console.error に記録する', async () => {
      const cause = Object.assign(
        new Error(`EPERM: operation not permitted, open '${SETTINGS_PATH}'`),
        {
          code: 'EPERM'
        }
      )
      mockReadFile.mockRejectedValue(cause)
      const err = await readFailure()
      expectFixedSettingsFileError(err)
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[settingsFileStore] failed to read settings file:',
        cause
      )
    })

    it.each([
      ['null', 'null'],
      ['配列', '[]'],
      ['数', '42'],
      ['文字列', JSON.stringify(SECRET_CONTENT)]
    ])(
      'JSON が普通のオブジェクトでない(%s)ときも固定の文言の SettingsFileError になる',
      async (_label, content) => {
        mockReadFile.mockResolvedValue(content)
        const err = await readFailure()
        expectFixedSettingsFileError(err)
        expect(consoleErrorSpy).toHaveBeenCalledOnce()
      }
    )

    it('書き込みの先頭の読み込みが壊れた JSON なら、固定の文言の SettingsFileError で失敗し、書き込まない', async () => {
      mockReadFile.mockResolvedValue(SECRET_CONTENT)
      const err = await writeSettingsFile({ modelId: 'claude-opus-4-8' }).then(
        () => {
          throw new Error('writeSettingsFile は失敗するはず')
        },
        (e: unknown) => e
      )
      expectFixedSettingsFileError(err)
      expect(mockWriteFile).not.toHaveBeenCalled()
      expect(mockRename).not.toHaveBeenCalled()
      // 読み込みの SettingsFileError をそのまま返す(書き込みの失敗として包み直さず、二重に記録しない)
      expect(consoleErrorSpy).toHaveBeenCalledOnce()
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        '[settingsFileStore] failed to read settings file:',
        expect.any(SyntaxError)
      )
    })

    it('ファイルが存在しない(ENOENT)ときは今までどおり空の設定を返し、console.error に記録しない', async () => {
      mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
      expect(await readSettingsFile()).toEqual({})
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    })
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
  // 書き込みの失敗の元の例外(fs の例外にはパスが入る)は console.error にだけ記録し、固定の文言の SettingsFileError で返す(L-017)
  let consoleErrorSpy: MockInstance<typeof console.error> | null = null

  beforeEach(() => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy?.mockRestore()
    consoleErrorSpy = null
  })

  async function writeFailure(): Promise<unknown> {
    return writeSettingsFile({ modelId: 'claude-opus-4-8' }).then(
      () => {
        throw new Error('writeSettingsFile は失敗するはず')
      },
      (err: unknown) => err
    )
  }

  function expectWriteFailureLogged(err: unknown, cause: unknown): void {
    expect(err).toBeInstanceOf(SettingsFileError)
    expect((err as Error).message).toBe(SETTINGS_FILE_ERROR_REASON)
    expect(String(err)).not.toContain('/mock/userData')
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[settingsFileStore] failed to write settings file:',
      cause
    )
  }

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
    const syncErr = Object.assign(new Error('EIO: sync failed'), { code: 'EIO' })
    mockSync.mockRejectedValueOnce(syncErr)
    expectWriteFailureLogged(await writeFailure(), syncErr)
    expect(mockClose).toHaveBeenCalledTimes(1)
    expect(mockRename).not.toHaveBeenCalled()
    expect(mockRm).toHaveBeenCalledWith(mockWriteFile.mock.calls[0][0], { force: true })
  })

  it('一時ファイルの後始末が失敗したら console.error に記録し、元の例外を記録してから SettingsFileError で返す', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const renameErr = Object.assign(new Error('EPERM: rename failed'), { code: 'EPERM' })
    const rmErr = Object.assign(new Error('EBUSY: rm failed'), { code: 'EBUSY' })
    mockRename.mockRejectedValueOnce(renameErr)
    mockRm.mockRejectedValueOnce(rmErr)
    expectWriteFailureLogged(await writeFailure(), renameErr)
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      '[settingsFileStore] failed to remove temp file:',
      rmErr
    )
  })

  it('rename が失敗したら一時ファイルを消し、元の例外(パスを含む)を記録して固定の文言の SettingsFileError を返す', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const renameErr = Object.assign(
      new Error(
        "EPERM: operation not permitted, rename '/mock/userData/settings.json.1.tmp' -> '/mock/userData/settings.json'"
      ),
      { code: 'EPERM' }
    )
    mockRename.mockRejectedValueOnce(renameErr)
    expectWriteFailureLogged(await writeFailure(), renameErr)
    expect(mockRm).toHaveBeenCalledWith(mockWriteFile.mock.calls[0][0], { force: true })
  })

  it('一時ファイルの作成が EEXIST なら、そのファイルを消さずに、元の例外を記録して SettingsFileError を返す', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const existErr = Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' })
    mockWriteFile.mockRejectedValueOnce(existErr)
    expectWriteFailureLogged(await writeFailure(), existErr)
    expect(mockRm).not.toHaveBeenCalled()
  })

  it('userData ディレクトリの作成(mkdir)の失敗も、元の例外を記録して SettingsFileError を返す', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    const mkdirErr = Object.assign(new Error("EACCES: permission denied, mkdir '/mock/userData'"), {
      code: 'EACCES'
    })
    mockMkdir.mockRejectedValueOnce(mkdirErr)
    expectWriteFailureLogged(await writeFailure(), mkdirErr)
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
    // 読み込みの失敗は console.error に記録されるため、書き込み(rename)の失敗で先行の write を失敗させる
    mockReadFile.mockResolvedValue(JSON.stringify({}))
    mockRename.mockRejectedValueOnce(new Error('unexpected write error'))

    await expect(writeSettingsFile({ modelId: 'claude-opus-4-8' })).rejects.toBeInstanceOf(
      SettingsFileError
    )
    await expect(writeSettingsFile({ maxTokens: 4096 })).resolves.toBeUndefined()
  })
})
