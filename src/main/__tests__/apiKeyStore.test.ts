import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

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
  app: { getPath: vi.fn(() => '/mock/userData') },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8'))
  }
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
import { getApiKey, setApiKey } from '../apiKeyStore'
import { ApiKeyDecryptError, KeystoreUnavailableError } from '../apiKeyErrors'
import { SettingsFileError } from '../settingsFileStore'
import { safeStorage } from 'electron'

const mockIsEncryptionAvailable = vi.mocked(safeStorage.isEncryptionAvailable)
const mockEncrypt = vi.mocked(safeStorage.encryptString)
const mockDecrypt = vi.mocked(safeStorage.decryptString)

beforeEach(() => {
  vi.clearAllMocks()
  // 書き込み先はシンボリックリンクではない(lstat は通常のファイルを返し、realpath は呼ばれない)
  mockLstat.mockResolvedValue({ isSymbolicLink: () => false })
  mockRealpath.mockImplementation(async (target: string) => target)
  mockIsEncryptionAvailable.mockReturnValue(true)
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

describe('getApiKey', () => {
  it('isEncryptionAvailable() が false のとき KeystoreUnavailableError を投げる', async () => {
    mockIsEncryptionAvailable.mockReturnValue(false)
    const rejection = getApiKey()
    await expect(rejection).rejects.toBeInstanceOf(KeystoreUnavailableError)
    await expect(rejection).rejects.toThrow('システムのキーストアが利用できません')
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('ファイルが存在しない場合は空文字を返す', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)
    expect(await getApiKey()).toBe('')
  })

  describe('settings.json の読み込みの失敗', () => {
    let consoleErrorSpy: MockInstance<typeof console.error> | null = null

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy?.mockRestore()
      consoleErrorSpy = null
    })

    it('ENOENT 以外のエラーは固定の文言の SettingsFileError として伝播する(パスを含まない。L-017)', async () => {
      const err = Object.assign(
        new Error("EPERM: operation not permitted, open '/mock/userData/settings.json'"),
        { code: 'EPERM' }
      )
      mockReadFile.mockRejectedValue(err)
      const rejection = getApiKey()
      await expect(rejection).rejects.toBeInstanceOf(SettingsFileError)
      await expect(rejection).rejects.toThrow(SETTINGS_FILE_ERROR_REASON)
    })
  })

  it('encryptedApiKey が保存されている場合は復号して返す', async () => {
    const encrypted = Buffer.from('sk-ant-test')
    const base64 = encrypted.toString('base64')
    mockReadFile.mockResolvedValue(JSON.stringify({ encryptedApiKey: base64 }))
    mockDecrypt.mockReturnValue('sk-ant-test')
    expect(await getApiKey()).toBe('sk-ant-test')
    expect(mockDecrypt).toHaveBeenCalledWith(expect.any(Buffer))
  })

  it('正しいパスのファイルを読み込む', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)
    await getApiKey()
    expect(mockReadFile).toHaveBeenCalledWith('/mock/userData/settings.json', 'utf-8')
  })

  it('apiKey が含まれていない場合は空文字を返す', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({}))
    expect(await getApiKey()).toBe('')
  })

  it('レガシー平文 apiKey を読み取り、暗号化して再保存する', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ apiKey: 'sk-ant-legacy' }))
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-legacy'))
    const result = await getApiKey()
    expect(result).toBe('sk-ant-legacy')
    expect(mockEncrypt).toHaveBeenCalledWith('sk-ant-legacy')
    expect(mockWriteFile).toHaveBeenCalledOnce()
  })

  it('マイグレーション後のファイルに平文 apiKey フィールドが残らない', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ apiKey: 'sk-ant-legacy' }))
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-legacy'))
    await getApiKey()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written).not.toHaveProperty('apiKey')
    expect(written).toHaveProperty('encryptedApiKey')
  })

  it('復号に失敗した場合は壊れたキーを削除して再設定を促す ApiKeyDecryptError を投げる', async () => {
    const base64 = Buffer.from('broken').toString('base64')
    mockReadFile.mockResolvedValue(JSON.stringify({ encryptedApiKey: base64 }))
    mockDecrypt.mockImplementation(() => {
      throw new Error('decryption failed')
    })
    const rejection = getApiKey()
    await expect(rejection).rejects.toBeInstanceOf(ApiKeyDecryptError)
    await expect(rejection).rejects.toThrow(
      '保存済みの API キーを復号できませんでした。API キーを再設定してください。'
    )
    expect(mockWriteFile).toHaveBeenCalledOnce()
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written).not.toHaveProperty('encryptedApiKey')
  })

  it('レガシー平文 apiKey に前後スペースがある場合は trim して保存・返却する', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ apiKey: '  sk-ant-legacy  ' }))
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-legacy'))
    const result = await getApiKey()
    expect(result).toBe('sk-ant-legacy')
    expect(mockEncrypt).toHaveBeenCalledWith('sk-ant-legacy')
  })

  it('レガシー平文 apiKey が空白のみの場合は空文字を返し保存しない', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ apiKey: '   ' }))
    const result = await getApiKey()
    expect(result).toBe('')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  describe('settings.json の不正なデータ', () => {
    it('encryptedApiKey が文字列でない(数)なら、復号できないキーとして削除し ApiKeyDecryptError を投げる', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ encryptedApiKey: 12345 }))
      await expect(getApiKey()).rejects.toBeInstanceOf(ApiKeyDecryptError)
      expect(mockDecrypt).not.toHaveBeenCalled()
      const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
      expect(written).not.toHaveProperty('encryptedApiKey')
    })

    it('encryptedApiKey が空文字なら暗号文として扱わず、レガシー平文 apiKey を読む', async () => {
      mockReadFile.mockResolvedValue(
        JSON.stringify({ encryptedApiKey: '', apiKey: 'sk-ant-legacy' })
      )
      await expect(getApiKey()).resolves.toBe('sk-ant-legacy')
      expect(mockDecrypt).not.toHaveBeenCalled()
      expect(mockEncrypt).toHaveBeenCalledWith('sk-ant-legacy')
    })
  })

  describe('書き込みの失敗', () => {
    let consoleErrorSpy: MockInstance<typeof console.error> | null = null

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    })

    afterEach(() => {
      consoleErrorSpy?.mockRestore()
      consoleErrorSpy = null
    })

    it('レガシー平文 apiKey の暗号化しての再保存に失敗したら、キーを返さずに SettingsFileError で失敗する', async () => {
      mockReadFile.mockResolvedValue(JSON.stringify({ apiKey: 'sk-ant-legacy' }))
      mockRename.mockRejectedValueOnce(Object.assign(new Error('EPERM'), { code: 'EPERM' }))
      await expect(getApiKey()).rejects.toBeInstanceOf(SettingsFileError)
    })
  })
})

describe('setApiKey', () => {
  it('isEncryptionAvailable() が false のとき KeystoreUnavailableError を投げる', async () => {
    mockIsEncryptionAvailable.mockReturnValue(false)
    const rejection = setApiKey('sk-ant-abc')
    await expect(rejection).rejects.toBeInstanceOf(KeystoreUnavailableError)
    await expect(rejection).rejects.toThrow('システムのキーストアが利用できません')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('safeStorage で暗号化して設定ファイルに書き込む', async () => {
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-abc'))
    await setApiKey('sk-ant-abc')
    const base64 = Buffer.from('sk-ant-abc').toString('base64')
    // 一時ファイルへ書いてから settings.json へ rename で置き換える(書きかけを読ませない)
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.stringMatching(/^\/mock\/userData\/settings\.json\.\d+\.[0-9a-f]{12}\.tmp$/),
      JSON.stringify({ encryptedApiKey: base64 }, null, 2),
      { encoding: 'utf-8', mode: 0o600, flag: 'wx' }
    )
    expect(mockRename).toHaveBeenCalledWith(
      mockWriteFile.mock.calls[0][0],
      '/mock/userData/settings.json'
    )
  })

  it('userData ディレクトリを再帰的に作成する', async () => {
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-abc'))
    await setApiKey('sk-ant-abc')
    expect(mockMkdir).toHaveBeenCalledWith('/mock/userData', { recursive: true })
  })

  it('encryptString を呼び出す', async () => {
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-abc'))
    await setApiKey('sk-ant-abc')
    expect(mockEncrypt).toHaveBeenCalledWith('sk-ant-abc')
  })

  it('settings.json の既存フィールドを保持したまま merge 書き込みする', async () => {
    mockReadFile.mockResolvedValue(JSON.stringify({ modelId: 'claude-haiku-4-5' }))
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-abc'))
    await setApiKey('sk-ant-abc')
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.modelId).toBe('claude-haiku-4-5')
    expect(written.encryptedApiKey).toBe(Buffer.from('sk-ant-abc').toString('base64'))
  })

  it('一時ファイルを writeFile した後、rename の前に chmod(0o600) を呼ぶ(置き換え後の権限も 0o600 にする)', async () => {
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-abc'))
    await setApiKey('sk-ant-abc')
    expect(mockChmod).toHaveBeenCalledWith(mockWriteFile.mock.calls[0][0], 0o600)
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0]
    const chmodOrder = mockChmod.mock.invocationCallOrder[0]
    const renameOrder = mockRename.mock.invocationCallOrder[0]
    expect(chmodOrder).toBeGreaterThan(writeOrder)
    expect(renameOrder).toBeGreaterThan(chmodOrder)
  })

  it('暗号化(encryptString)が例外を投げたら、そのまま伝え、何も書き込まない', async () => {
    mockEncrypt.mockImplementationOnce(() => {
      throw new Error('encryption failed')
    })
    await expect(setApiKey('sk-ant-abc')).rejects.toThrow('encryption failed')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('settings.json への書き込みに失敗したら、固定の文言の SettingsFileError で失敗する(L-017)', async () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      mockEncrypt.mockReturnValue(Buffer.from('sk-ant-abc'))
      mockRename.mockRejectedValueOnce(
        Object.assign(new Error("EPERM: operation not permitted, rename '/mock/userData'"), {
          code: 'EPERM'
        })
      )
      const rejection = setApiKey('sk-ant-abc')
      await expect(rejection).rejects.toBeInstanceOf(SettingsFileError)
      await expect(rejection).rejects.toThrow(SETTINGS_FILE_ERROR_REASON)
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })
})
