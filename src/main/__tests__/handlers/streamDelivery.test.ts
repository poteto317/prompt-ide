import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockUnregisterCancellation = vi.hoisted(() => vi.fn())

vi.mock('../../cancellationRegistry', () => ({
  unregisterCancellation: mockUnregisterCancellation
}))

import { createChunkSender, withCancellationCleanup } from '../../handlers/streamDelivery'

function makeEvent(): { sender: { isDestroyed: () => boolean; send: ReturnType<typeof vi.fn> } } {
  return { sender: { isDestroyed: vi.fn(() => false), send: vi.fn() } }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createChunkSender', () => {
  it('isDestroyed() が false のとき prompt:streamChunk を requestId 付きで送信する', () => {
    const event = makeEvent()
    const sendChunk = createChunkSender(event as never, 'req-1')
    sendChunk('チャンク')
    expect(event.sender.send).toHaveBeenCalledWith('prompt:streamChunk', {
      requestId: 'req-1',
      chunk: 'チャンク'
    })
  })

  it('isDestroyed() が true のとき送信しない', () => {
    const event = makeEvent()
    event.sender.isDestroyed = vi.fn(() => true)
    const sendChunk = createChunkSender(event as never, 'req-1')
    sendChunk('チャンク')
    expect(event.sender.send).not.toHaveBeenCalled()
  })

  it('複数回呼ぶとその都度送信する', () => {
    const event = makeEvent()
    const sendChunk = createChunkSender(event as never, 'req-1')
    sendChunk('1')
    sendChunk('2')
    expect(event.sender.send).toHaveBeenCalledTimes(2)
  })
})

describe('withCancellationCleanup', () => {
  it('task が成功したとき結果を返し unregisterCancellation を呼ぶ', async () => {
    const task = vi.fn().mockResolvedValue('結果')
    const result = await withCancellationCleanup('req-1', task)
    expect(result).toBe('結果')
    expect(mockUnregisterCancellation).toHaveBeenCalledWith('req-1')
  })

  it('task が失敗したときエラーを伝播しつつ unregisterCancellation を呼ぶ', async () => {
    const task = vi.fn().mockRejectedValue(new Error('失敗'))
    await expect(withCancellationCleanup('req-1', task)).rejects.toThrow('失敗')
    expect(mockUnregisterCancellation).toHaveBeenCalledWith('req-1')
  })

  it('unregisterCancellation は task 完了後に呼ばれる', async () => {
    const callOrder: string[] = []
    const task = vi.fn().mockImplementation(async () => {
      callOrder.push('task')
      return 'ok'
    })
    mockUnregisterCancellation.mockImplementation(() => callOrder.push('unregister'))
    await withCancellationCleanup('req-1', task)
    expect(callOrder).toEqual(['task', 'unregister'])
  })
})
