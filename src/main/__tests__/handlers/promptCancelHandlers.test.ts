import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockCancelRequest = vi.hoisted(() => vi.fn())

vi.mock('../../cancellationRegistry', () => ({
  cancelRequest: mockCancelRequest
}))

import { registerPromptCancelHandlers } from '../../handlers/promptCancelHandlers'

const mockHandle = vi.fn()
const mockIpcMain = { handle: mockHandle } as never

function getHandler(): (...args: unknown[]) => unknown {
  const call = mockHandle.mock.calls.find((c) => c[0] === 'prompt:cancel')
  if (!call) throw new Error('handler not found: prompt:cancel')
  return call[1] as (...args: unknown[]) => unknown
}

const makeEvent = (): object => ({})

beforeEach(() => {
  vi.clearAllMocks()
  registerPromptCancelHandlers(mockIpcMain)
})

describe('registerPromptCancelHandlers', () => {
  it('prompt:cancel ハンドラーが登録される', () => {
    expect(mockHandle).toHaveBeenCalledWith('prompt:cancel', expect.any(Function))
  })

  it('登録済みの requestId をキャンセルすると true を返す', async () => {
    mockCancelRequest.mockReturnValue(true)
    const result = await getHandler()(makeEvent(), { requestId: 'req-1' })
    expect(mockCancelRequest).toHaveBeenCalledWith('req-1')
    expect(result).toBe(true)
  })

  it('完了済み（未登録）の requestId は false を返すが throw しない', async () => {
    mockCancelRequest.mockReturnValue(false)
    const result = await getHandler()(makeEvent(), { requestId: 'done-req' })
    expect(result).toBe(false)
  })

  it('payload が null のとき例外をスロー', async () => {
    await expect(getHandler()(makeEvent(), null)).rejects.toThrow(
      '引数はオブジェクトである必要があります'
    )
  })

  it('requestId が文字列でないとき例外をスロー', async () => {
    await expect(getHandler()(makeEvent(), { requestId: 123 })).rejects.toThrow(
      'requestId は空でない文字列である必要があります'
    )
  })

  it('requestId が空白のみのとき例外をスロー', async () => {
    await expect(getHandler()(makeEvent(), { requestId: '   ' })).rejects.toThrow(
      'requestId は空でない文字列である必要があります'
    )
  })
})
