import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Mock } from 'vitest'

const mockRegisterCancellation = vi.hoisted(() => vi.fn())
const mockUnregisterCancellation = vi.hoisted(() => vi.fn())

vi.mock('../../cliService')
vi.mock('../../cancellationRegistry', () => ({
  registerCancellation: mockRegisterCancellation,
  unregisterCancellation: mockUnregisterCancellation
}))

import * as cliService from '../../cliService'
import { registerCLIHandlers } from '../../handlers/cliHandlers'

const mockRunCLIPrompt = vi.mocked(cliService.runCLIPrompt)

interface FakeIpcMain {
  handle: Mock<(channel: string, fn: (...args: unknown[]) => unknown) => void>
  getHandler: (channel: string) => (...args: unknown[]) => unknown
}

function buildIpcMain(): FakeIpcMain {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      handlers.set(channel, fn)
    }),
    getHandler: (channel: string) => handlers.get(channel)!
  }
}

function makeEvent(): { sender: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } } {
  return { sender: { isDestroyed: vi.fn(() => false), send: vi.fn() } }
}

const validPayload = { requestId: 'req-uuid-1', toolId: 'claude', promptContent: 'テスト' }

let ipcMain: ReturnType<typeof buildIpcMain>
let handler: (...args: unknown[]) => unknown

beforeEach(() => {
  vi.clearAllMocks()
  ipcMain = buildIpcMain()
  registerCLIHandlers(ipcMain as never)
  handler = ipcMain.getHandler('cli:runPromptStream')
})

describe('registerCLIHandlers', () => {
  it('cli:runPromptStream ハンドラーが登録される', () => {
    expect(ipcMain.handle).toHaveBeenCalledWith('cli:runPromptStream', expect.any(Function))
  })

  it('正常系: runCLIPrompt の結果を返す', async () => {
    mockRunCLIPrompt.mockResolvedValue('CLI出力')

    const result = await handler(makeEvent(), validPayload)

    expect(mockRunCLIPrompt).toHaveBeenCalledWith(
      'claude',
      'テスト',
      expect.objectContaining({
        onChunk: expect.any(Function),
        registerCancel: expect.any(Function)
      })
    )
    expect(result).toBe('CLI出力')
  })

  it('onChunk が event.sender.send でチャンクを requestId 付きで転送する', async () => {
    mockRunCLIPrompt.mockResolvedValue('CLI出力')
    const event = makeEvent()
    await handler(event, validPayload)

    const options = mockRunCLIPrompt.mock.calls[0][2]!
    options.onChunk!('チャンク')
    expect(event.sender.send).toHaveBeenCalledWith('prompt:streamChunk', {
      requestId: 'req-uuid-1',
      chunk: 'チャンク'
    })
  })

  it('sender が destroyed のとき send しない', async () => {
    mockRunCLIPrompt.mockResolvedValue('CLI出力')
    const event = makeEvent()
    event.sender.isDestroyed = vi.fn(() => true)
    await handler(event, validPayload)

    const options = mockRunCLIPrompt.mock.calls[0][2]!
    options.onChunk!('チャンク')
    expect(event.sender.send).not.toHaveBeenCalled()
  })

  it('registerCancel がキャンセル関数をレジストリに登録する', async () => {
    mockRunCLIPrompt.mockResolvedValue('CLI出力')
    await handler(makeEvent(), validPayload)

    const options = mockRunCLIPrompt.mock.calls[0][2]!
    const cancel = vi.fn()
    options.registerCancel!(cancel)
    expect(mockRegisterCancellation).toHaveBeenCalledWith('req-uuid-1', cancel)
  })

  it('完了後にキャンセル登録を解除する', async () => {
    mockRunCLIPrompt.mockResolvedValue('CLI出力')
    await handler(makeEvent(), validPayload)
    expect(mockUnregisterCancellation).toHaveBeenCalledWith('req-uuid-1')
  })

  it('runCLIPrompt が reject してもキャンセル登録を解除する', async () => {
    mockRunCLIPrompt.mockRejectedValue(new Error('spawn error'))
    await expect(handler(makeEvent(), validPayload)).rejects.toThrow('spawn error')
    expect(mockUnregisterCancellation).toHaveBeenCalledWith('req-uuid-1')
  })

  it('payload が null のとき引数バリデーションエラーを投げる', async () => {
    await expect(handler(makeEvent(), null)).rejects.toThrow(
      '引数はオブジェクトである必要があります'
    )
  })

  it('requestId がないとき requestId バリデーションエラーを投げる', async () => {
    await expect(
      handler(makeEvent(), { toolId: 'claude', promptContent: 'テスト' })
    ).rejects.toThrow('requestId は空でない文字列である必要があります')
  })

  it('toolId が文字列でないとき toolId バリデーションエラーを投げる', async () => {
    await expect(
      handler(makeEvent(), { requestId: 'req-1', toolId: 123, promptContent: 'テスト' })
    ).rejects.toThrow('toolId は文字列である必要があります')
  })

  it("toolId が 'api' のとき allowlist エラーを投げる（CLI ハンドラーでは無効な値）", async () => {
    await expect(
      handler(makeEvent(), { requestId: 'req-1', toolId: 'api', promptContent: 'テスト' })
    ).rejects.toThrow(
      "toolId は 'claude' または 'copilot' である必要があります（受け取った値: api）"
    )
  })

  it('promptContent が文字列でないとき promptContent バリデーションエラーを投げる', async () => {
    await expect(
      handler(makeEvent(), { requestId: 'req-1', toolId: 'claude', promptContent: null })
    ).rejects.toThrow('promptContent は文字列である必要があります')
  })

  it('promptContent が空白のみのとき空文字バリデーションエラーを投げる', async () => {
    await expect(
      handler(makeEvent(), { requestId: 'req-1', toolId: 'claude', promptContent: '   ' })
    ).rejects.toThrow('promptContent は空文字列にできません')
  })

  it('runCLIPrompt が throw したときエラーが伝播する', async () => {
    mockRunCLIPrompt.mockRejectedValue(new Error('spawn error'))

    await expect(handler(makeEvent(), validPayload)).rejects.toThrow('spawn error')
  })
})
