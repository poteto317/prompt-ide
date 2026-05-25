import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockGetApiKey = vi.hoisted(() => vi.fn())
const mockRunPrompt = vi.hoisted(() => vi.fn())

vi.mock('../../settingsStore', () => ({ getApiKey: mockGetApiKey }))
vi.mock('../../claudeService', () => ({ runPrompt: mockRunPrompt }))

import { registerClaudeHandlers } from '../../handlers/claudeHandlers'

const mockIpcMain = { handle: mockHandle } as never

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find(([ch]) => ch === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(senderId: number) {
  return { sender: { id: senderId } }
}

beforeEach(() => {
  vi.clearAllMocks()
  registerClaudeHandlers(mockIpcMain)
})

describe('registerClaudeHandlers', () => {
  describe('claude:runPrompt', () => {
    it('API キーが設定されているとき runPrompt を呼んで結果を返す', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPrompt.mockResolvedValue('回答テキスト')
      const result = await getRegisteredHandler('claude:runPrompt')(makeEvent(1), {
        promptContent: 'プロンプト',
        fileContent: 'ファイル',
      })
      expect(mockRunPrompt).toHaveBeenCalledWith('sk-ant-key', 'プロンプト', 'ファイル')
      expect(result).toBe('回答テキスト')
    })

    it('fileContent が null のとき null を runPrompt に渡す', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPrompt.mockResolvedValue('回答テキスト')
      await getRegisteredHandler('claude:runPrompt')(makeEvent(1), {
        promptContent: 'プロンプト',
        fileContent: null,
      })
      expect(mockRunPrompt).toHaveBeenCalledWith('sk-ant-key', 'プロンプト', null)
    })

    it('API キーの前後スペースを trim して runPrompt に渡す', async () => {
      mockGetApiKey.mockResolvedValue('  sk-ant-key  ')
      mockRunPrompt.mockResolvedValue('回答')
      await getRegisteredHandler('claude:runPrompt')(makeEvent(1), {
        promptContent: 'プロンプト',
        fileContent: null,
      })
      expect(mockRunPrompt).toHaveBeenCalledWith('sk-ant-key', 'プロンプト', null)
    })

    it('API キーが未設定のとき "API キーが設定されていません" エラーをスロー', async () => {
      mockGetApiKey.mockResolvedValue('')
      await expect(
        getRegisteredHandler('claude:runPrompt')(makeEvent(1), {
          promptContent: 'プロンプト',
          fileContent: null,
        })
      ).rejects.toThrow('API キーが設定されていません')
      expect(mockRunPrompt).not.toHaveBeenCalled()
    })

    it('API キーが空白のみのとき "API キーが設定されていません" エラーをスロー', async () => {
      mockGetApiKey.mockResolvedValue('   ')
      await expect(
        getRegisteredHandler('claude:runPrompt')(makeEvent(1), {
          promptContent: 'プロンプト',
          fileContent: null,
        })
      ).rejects.toThrow('API キーが設定されていません')
    })

    it('payload が null のとき "引数はオブジェクトである必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('claude:runPrompt')(makeEvent(1), null)
      ).rejects.toThrow('引数はオブジェクトである必要があります')
    })

    it('payload が undefined のとき "引数はオブジェクトである必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('claude:runPrompt')(makeEvent(1), undefined)
      ).rejects.toThrow('引数はオブジェクトである必要があります')
    })

    it('payload が数値のとき "引数はオブジェクトである必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('claude:runPrompt')(makeEvent(1), 42)
      ).rejects.toThrow('引数はオブジェクトである必要があります')
    })

    it('promptContent が文字列でないとき "promptContent は文字列である必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('claude:runPrompt')(makeEvent(1), {
          promptContent: 123,
          fileContent: null,
        })
      ).rejects.toThrow('promptContent は文字列である必要があります')
    })

    it('fileContent が null でも文字列でもないとき "fileContent は文字列または null" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('claude:runPrompt')(makeEvent(1), {
          promptContent: 'プロンプト',
          fileContent: 123,
        })
      ).rejects.toThrow('fileContent は文字列または null である必要があります')
    })

    it('runPrompt が throw した場合エラーが伝播する', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPrompt.mockRejectedValue(new Error('api error'))
      await expect(
        getRegisteredHandler('claude:runPrompt')(makeEvent(1), {
          promptContent: 'プロンプト',
          fileContent: null,
        })
      ).rejects.toThrow('api error')
    })
  })
})
