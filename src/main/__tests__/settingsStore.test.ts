import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.hoisted(() => vi.fn())
const mockWriteFile = vi.hoisted(() => vi.fn())
const mockMkdir = vi.hoisted(() => vi.fn())
const mockChmod = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => '/mock/userData') },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((str: string) => Buffer.from(str)),
    decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8')),
  },
}))

vi.mock('node:fs/promises', () => ({
  default: { readFile: mockReadFile, writeFile: mockWriteFile, mkdir: mockMkdir, chmod: mockChmod },
  readFile: mockReadFile,
  writeFile: mockWriteFile,
  mkdir: mockMkdir,
  chmod: mockChmod,
}))

import { getApiKey, setApiKey } from '../settingsStore'
import { safeStorage } from 'electron'

const mockIsEncryptionAvailable = vi.mocked(safeStorage.isEncryptionAvailable)
const mockEncrypt = vi.mocked(safeStorage.encryptString)
const mockDecrypt = vi.mocked(safeStorage.decryptString)

beforeEach(() => {
  vi.clearAllMocks()
  mockIsEncryptionAvailable.mockReturnValue(true)
  mockMkdir.mockResolvedValue(undefined)
  mockWriteFile.mockResolvedValue(undefined)
  mockChmod.mockResolvedValue(undefined)
})

describe('getApiKey', () => {
  it('isEncryptionAvailable() が false のとき エラーを投げる', async () => {
    mockIsEncryptionAvailable.mockReturnValue(false)
    await expect(getApiKey()).rejects.toThrow('システムのキーストアが利用できません')
    expect(mockReadFile).not.toHaveBeenCalled()
  })

  it('ファイルが存在しない場合は空文字を返す', async () => {
    const err = Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(err)
    expect(await getApiKey()).toBe('')
  })

  it('ENOENT 以外のエラーは伝播する', async () => {
    const err = Object.assign(new Error('EPERM'), { code: 'EPERM' })
    mockReadFile.mockRejectedValue(err)
    await expect(getApiKey()).rejects.toThrow('EPERM')
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
})

describe('setApiKey', () => {
  it('isEncryptionAvailable() が false のとき エラーを投げる', async () => {
    mockIsEncryptionAvailable.mockReturnValue(false)
    await expect(setApiKey('sk-ant-abc')).rejects.toThrow('システムのキーストアが利用できません')
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('safeStorage で暗号化して設定ファイルに書き込む', async () => {
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-abc'))
    await setApiKey('sk-ant-abc')
    const base64 = Buffer.from('sk-ant-abc').toString('base64')
    expect(mockWriteFile).toHaveBeenCalledWith(
      '/mock/userData/settings.json',
      JSON.stringify({ encryptedApiKey: base64 }, null, 2),
      { encoding: 'utf-8', mode: 0o600 }
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

  it('writeFile 後に chmod(0o600) を呼んで既存ファイルの権限も確実に設定する', async () => {
    mockEncrypt.mockReturnValue(Buffer.from('sk-ant-abc'))
    await setApiKey('sk-ant-abc')
    expect(mockChmod).toHaveBeenCalledWith('/mock/userData/settings.json', 0o600)
    // chmod は writeFile の後に呼ばれる
    const writeOrder = mockWriteFile.mock.invocationCallOrder[0]
    const chmodOrder = mockChmod.mock.invocationCallOrder[0]
    expect(chmodOrder).toBeGreaterThan(writeOrder)
  })
})
