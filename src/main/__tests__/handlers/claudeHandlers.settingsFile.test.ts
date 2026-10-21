import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

// 従来の方式の実行(claude:runPromptStream)で、settings.json の失敗が固定の文言で返ることを、本物の apiKeyStore・
// modelSettingsStore・settingsFileStore を通して確かめる(L-017)。settings.json は一時ディレクトリに置き、利用者の
// settings.json には触らない。Claude API(claudeService)はモックにし、実物には繋がない

const userDataDir = vi.hoisted(() => ({ current: '' }))
const mockHandle = vi.hoisted(() => vi.fn())
const mockRunPromptStream = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  app: { getPath: vi.fn(() => userDataDir.current) },
  safeStorage: {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((plain: string) => Buffer.from(plain, 'utf-8')),
    decryptString: vi.fn((buf: Buffer) => buf.toString('utf-8'))
  }
}))
vi.mock('../../claudeService', () => ({ runPromptStream: mockRunPromptStream }))

import { SETTINGS_FILE_ERROR_REASON } from '@shared/settingsFileMessages'
import { registerClaudeHandlers } from '../../handlers/claudeHandlers'

const SECRET_CONTENT = 'djEwSECRET{'

const validPayload = { requestId: 'req-settings-1', promptContent: 'プロンプト', fileContent: null }

function getHandler(): (...args: unknown[]) => Promise<unknown> {
  const call = mockHandle.mock.calls.find((c) => c[0] === 'claude:runPromptStream')
  if (!call) throw new Error('handler not found')
  return call[1] as (...args: unknown[]) => Promise<unknown>
}

function makeEvent(): { sender: { id: number; isDestroyed: () => boolean; send: () => void } } {
  return { sender: { id: 1, isDestroyed: () => false, send: vi.fn() } }
}

async function runFailure(): Promise<Error> {
  return getHandler()(makeEvent(), validPayload).then(
    () => {
      throw new Error('claude:runPromptStream は失敗するはず')
    },
    (err: unknown) => err as Error
  )
}

let consoleErrorSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.clearAllMocks()
  userDataDir.current = mkdtempSync(join(tmpdir(), 'prompt-ide-claude-handlers-'))
  consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
  registerClaudeHandlers({ handle: mockHandle } as never)
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
  rmSync(userDataDir.current, { recursive: true, force: true })
})

describe('claude:runPromptStream と settings.json の失敗', () => {
  it('settings.json が壊れているときは固定の文言で返り、中身もパスも含まず、API を呼ばない', async () => {
    writeFileSync(join(userDataDir.current, 'settings.json'), SECRET_CONTENT, 'utf-8')
    const err = await runFailure()
    expect(err.message).toBe(SETTINGS_FILE_ERROR_REASON)
    expect(String(err)).not.toContain(SECRET_CONTENT)
    expect(String(err)).not.toContain(userDataDir.current)
    expect(mockRunPromptStream).not.toHaveBeenCalled()
  })

  it('Claude API の失敗の文言はこれまでどおりそのまま返る', async () => {
    writeFileSync(
      join(userDataDir.current, 'settings.json'),
      JSON.stringify({ encryptedApiKey: Buffer.from('sk-ant-key', 'utf-8').toString('base64') }),
      'utf-8'
    )
    mockRunPromptStream.mockRejectedValue(new Error('Claude API エラー: 401 invalid x-api-key'))
    const err = await runFailure()
    expect(err.message).toBe('Claude API エラー: 401 invalid x-api-key')
    expect(mockRunPromptStream).toHaveBeenCalledWith(
      'sk-ant-key',
      'プロンプト',
      null,
      expect.anything()
    )
  })
})
