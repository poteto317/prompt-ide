import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

// settings:hasApiKey が、本物の apiKeyStore・settingsFileStore を通して失敗を理由の種類に変えて返すことを確かめる
// (L-017)。settings.json は一時ディレクトリに置き、利用者の settings.json には触らない。safeStorage はモックにし、
// 利用者のキーチェーンには触らない

const userDataDir = vi.hoisted(() => ({ current: '' }))
const mockHandle = vi.hoisted(() => vi.fn())
const keystore = vi.hoisted(() => ({ available: true, decryptFails: false }))
// rename の失敗を作るための差し替え(Windows でほかのアプリが settings.json を開いているときの EPERM を模す。文言にパスが入る)
const fsHooks = vi.hoisted(() => ({ renameFails: false }))

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => userDataDir.current) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => keystore.available),
    encryptString: vi.fn((plain: string) => Buffer.from(plain, 'utf-8')),
    decryptString: vi.fn((buf: Buffer) => {
      if (keystore.decryptFails) throw new Error('Error while decrypting the ciphertext provided')
      return buf.toString('utf-8')
    })
  }
}))

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  const rename: typeof actual.rename = async (from, to) => {
    if (fsHooks.renameFails) {
      throw Object.assign(
        new Error(`EPERM: operation not permitted, rename '${String(from)}' -> '${String(to)}'`),
        { code: 'EPERM' }
      )
    }
    return actual.rename(from, to)
  }
  const mocked = { ...actual, rename }
  return { ...mocked, default: mocked }
})

import { registerSettingsHandlers } from '../../handlers/settingsHandlers'
import { removeTempPathSync } from '../helpers/tempDirGuard'

const SECRET_CONTENT = 'djEwSECRET{'

function settingsPath(): string {
  return join(userDataDir.current, 'settings.json')
}

async function invokeHasApiKey(): Promise<unknown> {
  const call = mockHandle.mock.calls.find((c) => c[0] === 'settings:hasApiKey')
  if (!call) throw new Error('handler not found')
  return (call[1] as (...args: unknown[]) => Promise<unknown>)({ sender: { id: 1 } })
}

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.clearAllMocks()
  keystore.available = true
  keystore.decryptFails = false
  fsHooks.renameFails = false
  userDataDir.current = mkdtempSync(join(tmpdir(), 'prompt-ide-settings-handlers-'))
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  registerSettingsHandlers({ handle: mockHandle } as never)
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
  // 準備が失敗して空のままなら消さない
  if (userDataDir.current !== '') removeTempPathSync(userDataDir.current)
})

describe('settings:hasApiKey と API キーの読み込みの失敗', () => {
  it('settings.json が無いときはキーが無いことを返す', async () => {
    await expect(invokeHasApiKey()).resolves.toEqual({ ok: true, hasKey: false })
  })

  it('保存済みのキーがあるときはキーがあることを返す', async () => {
    writeFileSync(
      settingsPath(),
      JSON.stringify({ encryptedApiKey: Buffer.from('sk-ant-key', 'utf-8').toString('base64') }),
      'utf-8'
    )
    await expect(invokeHasApiKey()).resolves.toEqual({ ok: true, hasKey: true })
  })

  it('settings.json が壊れているときは settings-file-error だけを返し、中身もパスも含まない', async () => {
    writeFileSync(settingsPath(), SECRET_CONTENT, 'utf-8')
    const result = await invokeHasApiKey()
    expect(result).toEqual({ ok: false, reason: 'settings-file-error' })
    expect(JSON.stringify(result)).not.toContain(SECRET_CONTENT)
    expect(JSON.stringify(result)).not.toContain(userDataDir.current)
  })

  it('復号できないときは decrypt-failed を返し、キーを消してある(再起動するとキーが無い状態になる)', async () => {
    writeFileSync(settingsPath(), JSON.stringify({ encryptedApiKey: 'YnJva2Vu' }), 'utf-8')
    keystore.decryptFails = true
    await expect(invokeHasApiKey()).resolves.toEqual({ ok: false, reason: 'decrypt-failed' })
    expect(JSON.parse(readFileSync(settingsPath(), 'utf-8'))).not.toHaveProperty('encryptedApiKey')
    keystore.decryptFails = false
    await expect(invokeHasApiKey()).resolves.toEqual({ ok: true, hasKey: false })
  })

  it('復号できないキーを消す書き込みが失敗したときは settings-file-error を返し、パスを含まない', async () => {
    const original = JSON.stringify({ encryptedApiKey: 'YnJva2Vu' })
    writeFileSync(settingsPath(), original, 'utf-8')
    keystore.decryptFails = true
    fsHooks.renameFails = true
    const result = await invokeHasApiKey()
    expect(result).toEqual({ ok: false, reason: 'settings-file-error' })
    expect(JSON.stringify(result)).not.toContain(userDataDir.current)
    expect(readFileSync(settingsPath(), 'utf-8')).toBe(original)
  })

  it('キーストアが使えないときは keystore-unavailable を返す', async () => {
    keystore.available = false
    await expect(invokeHasApiKey()).resolves.toEqual({ ok: false, reason: 'keystore-unavailable' })
  })
})
