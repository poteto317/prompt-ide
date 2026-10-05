import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFromId = vi.hoisted(() => vi.fn())

vi.mock('electron', () => ({
  webContents: { fromId: mockFromId }
}))

import { isDestroyedSafely, sendSafely, sendToOwner } from '../safeWebContentsSend'

beforeEach(() => {
  vi.resetAllMocks()
})

const destroyedError = (): never => {
  throw new Error('Object has been destroyed')
}

describe('isDestroyedSafely', () => {
  it('isDestroyed の結果を返す', () => {
    expect(isDestroyedSafely({ isDestroyed: () => false })).toBe(false)
    expect(isDestroyedSafely({ isDestroyed: () => true })).toBe(true)
  })

  it('isDestroyed が例外を投げたら破棄済みとみなす', () => {
    expect(isDestroyedSafely({ isDestroyed: destroyedError })).toBe(true)
  })
})

describe('sendSafely', () => {
  it('破棄されていなければ送る', () => {
    const send = vi.fn()
    sendSafely({ isDestroyed: () => false, send }, 'ch', { a: 1 })
    expect(send).toHaveBeenCalledWith('ch', { a: 1 })
  })

  it('破棄済みなら送らない', () => {
    const send = vi.fn()
    sendSafely({ isDestroyed: () => true, send }, 'ch', { a: 1 })
    expect(send).not.toHaveBeenCalled()
  })

  it('send が例外を投げても呼び出し元へ投げない(確認と送信の間の破棄の競合)', () => {
    expect(() =>
      sendSafely({ isDestroyed: () => false, send: destroyedError }, 'ch', 1)
    ).not.toThrow()
  })

  it('isDestroyed が例外を投げても呼び出し元へ投げず、送らない', () => {
    const send = vi.fn()
    expect(() => sendSafely({ isDestroyed: destroyedError, send }, 'ch', 1)).not.toThrow()
    expect(send).not.toHaveBeenCalled()
  })
})

describe('sendToOwner', () => {
  it('webContents.fromId で所有者を引いて送る', () => {
    const send = vi.fn()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => false, send })
    sendToOwner(3, 'ch', { paths: ['/a'] })
    expect(mockFromId).toHaveBeenCalledWith(3)
    expect(send).toHaveBeenCalledWith('ch', { paths: ['/a'] })
  })

  it('所有者が見つからなければ何もしない', () => {
    mockFromId.mockReturnValueOnce(undefined)
    expect(() => sendToOwner(4, 'ch', 1)).not.toThrow()
  })

  it('破棄済みの所有者へは送らない', () => {
    const send = vi.fn()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => true, send })
    sendToOwner(3, 'ch', 1)
    expect(send).not.toHaveBeenCalled()
  })

  it('fromId・send が例外を投げても呼び出し元へ投げない', () => {
    mockFromId.mockImplementationOnce(destroyedError)
    expect(() => sendToOwner(3, 'ch', 1)).not.toThrow()
    mockFromId.mockReturnValueOnce({ isDestroyed: () => false, send: destroyedError })
    expect(() => sendToOwner(3, 'ch', 1)).not.toThrow()
  })
})
