import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockHandle = vi.hoisted(() => vi.fn())
const mockGetApiKey = vi.hoisted(() => vi.fn())
const mockGetModelSettings = vi.hoisted(() => vi.fn())
const mockRunPromptStream = vi.hoisted(() => vi.fn())
const mockRegisterCancellation = vi.hoisted(() => vi.fn())
const mockUnregisterCancellation = vi.hoisted(() => vi.fn())

vi.mock('../../apiKeyStore', () => ({ getApiKey: mockGetApiKey }))
vi.mock('../../modelSettingsStore', () => ({ getModelSettings: mockGetModelSettings }))
vi.mock('../../claudeService', () => ({ runPromptStream: mockRunPromptStream }))
vi.mock('../../cancellationRegistry', () => ({
  registerCancellation: mockRegisterCancellation,
  unregisterCancellation: mockUnregisterCancellation
}))

import { registerClaudeHandlers } from '../../handlers/claudeHandlers'

const mockIpcMain = { handle: mockHandle } as never

function getRegisteredHandler(channel: string): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === channel)
  if (!call) throw new Error(`handler not found: ${channel}`)
  return call[1] as (...args: unknown[]) => unknown
}

function makeEvent(): {
  sender: { id: number; isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> }
} {
  return { sender: { id: 1, isDestroyed: vi.fn(() => false), send: vi.fn() } }
}

const validPayload = {
  requestId: 'req-uuid-1',
  promptContent: 'プロンプト',
  fileContent: null as string | null
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetModelSettings.mockResolvedValue({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
  registerClaudeHandlers(mockIpcMain)
})

describe('registerClaudeHandlers', () => {
  describe('claude:runPromptStream', () => {
    it('API キーが設定されているとき runPromptStream を呼んで結果を返す', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPromptStream.mockResolvedValue('回答テキスト')
      const result = await getRegisteredHandler('claude:runPromptStream')(makeEvent(), {
        ...validPayload,
        fileContent: 'ファイル'
      })
      expect(mockRunPromptStream).toHaveBeenCalledWith(
        'sk-ant-key',
        'プロンプト',
        'ファイル',
        expect.objectContaining({ model: 'claude-haiku-4-5', maxTokens: 4096 })
      )
      expect(result).toBe('回答テキスト')
    })

    it('保存済みのモデル設定を runPromptStream に渡す', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockGetModelSettings.mockResolvedValue({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
      mockRunPromptStream.mockResolvedValue('回答')
      await getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      expect(mockRunPromptStream).toHaveBeenCalledWith(
        'sk-ant-key',
        'プロンプト',
        null,
        expect.objectContaining({ model: 'claude-opus-4-8', maxTokens: 8000 })
      )
    })

    it('AbortController の signal を runPromptStream に渡す', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPromptStream.mockResolvedValue('回答')
      await getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      const options = mockRunPromptStream.mock.calls[0][3]
      expect(options.signal).toBeInstanceOf(AbortSignal)
    })

    it('requestId でキャンセルを登録し、完了後に解除する', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPromptStream.mockResolvedValue('回答')
      await getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      expect(mockRegisterCancellation).toHaveBeenCalledWith('req-uuid-1', expect.any(Function))
      expect(mockUnregisterCancellation).toHaveBeenCalledWith('req-uuid-1')
    })

    it('runPromptStream が reject してもキャンセル登録を解除する', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPromptStream.mockRejectedValue(new Error('api error'))
      await expect(
        getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      ).rejects.toThrow('api error')
      expect(mockUnregisterCancellation).toHaveBeenCalledWith('req-uuid-1')
    })

    it('登録されたキャンセル関数を呼ぶと AbortSignal が中断状態になる', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPromptStream.mockResolvedValue('回答')
      await getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      const cancel = mockRegisterCancellation.mock.calls[0][1] as () => void
      const options = mockRunPromptStream.mock.calls[0][3]
      expect(options.signal.aborted).toBe(false)
      cancel()
      expect(options.signal.aborted).toBe(true)
    })

    it('onChunk が event.sender.send でチャンクを requestId 付きで転送する', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPromptStream.mockResolvedValue('回答')
      const event = makeEvent()
      await getRegisteredHandler('claude:runPromptStream')(event, validPayload)
      const options = mockRunPromptStream.mock.calls[0][3]
      options.onChunk('チャンク')
      expect(event.sender.send).toHaveBeenCalledWith('prompt:streamChunk', {
        requestId: 'req-uuid-1',
        chunk: 'チャンク'
      })
    })

    it('sender が destroyed のとき send しない', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPromptStream.mockResolvedValue('回答')
      const event = makeEvent()
      event.sender.isDestroyed = vi.fn(() => true)
      await getRegisteredHandler('claude:runPromptStream')(event, validPayload)
      const options = mockRunPromptStream.mock.calls[0][3]
      options.onChunk('チャンク')
      expect(event.sender.send).not.toHaveBeenCalled()
    })

    it('API キーの前後スペースを trim して runPromptStream に渡す', async () => {
      mockGetApiKey.mockResolvedValue('  sk-ant-key  ')
      mockRunPromptStream.mockResolvedValue('回答')
      await getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      expect(mockRunPromptStream.mock.calls[0][0]).toBe('sk-ant-key')
    })

    it('API キーが未設定のとき "API キーが設定されていません" エラーをスロー', async () => {
      mockGetApiKey.mockResolvedValue('')
      await expect(
        getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      ).rejects.toThrow('API キーが設定されていません')
      expect(mockRunPromptStream).not.toHaveBeenCalled()
      // 登録は最初の await より前に行われるため、エラーパスでも解除される
      expect(mockUnregisterCancellation).toHaveBeenCalledWith('req-uuid-1')
    })

    it('API キーが空白のみのとき "API キーが設定されていません" エラーをスロー', async () => {
      mockGetApiKey.mockResolvedValue('   ')
      await expect(
        getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      ).rejects.toThrow('API キーが設定されていません')
      expect(mockRunPromptStream).not.toHaveBeenCalled()
    })

    it('設定読み込みの完了を待たずにキャンセルを登録する', async () => {
      // getApiKey を未解決のまま保留し、ハンドラ呼び出し直後に登録済みであることを確認する
      let resolveApiKey: (key: string) => void = () => {}
      mockGetApiKey.mockReturnValue(new Promise<string>((r) => (resolveApiKey = r)))
      mockRunPromptStream.mockResolvedValue('回答')

      const pending = getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      expect(mockRegisterCancellation).toHaveBeenCalledWith('req-uuid-1', expect.any(Function))

      resolveApiKey('sk-ant-key')
      await pending
    })

    it('設定読み込み中にキャンセルされたら API を呼ばず "キャンセルされました" で reject する', async () => {
      let resolveApiKey: (key: string) => void = () => {}
      mockGetApiKey.mockReturnValue(new Promise<string>((r) => (resolveApiKey = r)))

      const pending = getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      // 設定読み込み待機中(getApiKey 未解決)にキャンセルが要求されたケース
      const cancel = mockRegisterCancellation.mock.calls[0][1] as () => void
      cancel()
      resolveApiKey('sk-ant-key')

      await expect(pending).rejects.toThrow('キャンセルされました')
      expect(mockRunPromptStream).not.toHaveBeenCalled()
      expect(mockUnregisterCancellation).toHaveBeenCalledWith('req-uuid-1')
    })

    it('payload が null のとき "引数はオブジェクトである必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('claude:runPromptStream')(makeEvent(), null)
      ).rejects.toThrow('引数はオブジェクトである必要があります')
    })

    it('requestId がないとき "requestId は空でない文字列である必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('claude:runPromptStream')(makeEvent(), {
          promptContent: 'プロンプト',
          fileContent: null
        })
      ).rejects.toThrow('requestId は空でない文字列である必要があります')
    })

    it('promptContent が文字列でないとき "promptContent は文字列である必要があります" エラーをスロー', async () => {
      await expect(
        getRegisteredHandler('claude:runPromptStream')(makeEvent(), {
          requestId: 'req-1',
          promptContent: 123,
          fileContent: null
        })
      ).rejects.toThrow('promptContent は文字列である必要があります')
    })

    it('runPromptStream が throw した場合エラーが伝播する', async () => {
      mockGetApiKey.mockResolvedValue('sk-ant-key')
      mockRunPromptStream.mockRejectedValue(new Error('api error'))
      await expect(
        getRegisteredHandler('claude:runPromptStream')(makeEvent(), validPayload)
      ).rejects.toThrow('api error')
    })
  })
})
