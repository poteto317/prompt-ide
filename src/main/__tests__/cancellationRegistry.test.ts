import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  registerCancellation,
  unregisterCancellation,
  cancelRequest
} from '../cancellationRegistry'

beforeEach(() => {
  // モジュールスコープの Map に前テストの登録が残らないよう明示的に掃除する
  unregisterCancellation('req-1')
  unregisterCancellation('req-2')
})

describe('cancellationRegistry', () => {
  it('登録済みの requestId をキャンセルすると cancel が呼ばれ true を返す', () => {
    const cancel = vi.fn()
    registerCancellation('req-1', cancel)
    expect(cancelRequest('req-1')).toBe(true)
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('未登録の requestId のキャンセルは false を返す', () => {
    expect(cancelRequest('unknown')).toBe(false)
  })

  it('unregister 後のキャンセルは false を返し cancel は呼ばれない', () => {
    const cancel = vi.fn()
    registerCancellation('req-1', cancel)
    unregisterCancellation('req-1')
    expect(cancelRequest('req-1')).toBe(false)
    expect(cancel).not.toHaveBeenCalled()
  })

  it('複数の requestId を独立して管理できる', () => {
    const cancel1 = vi.fn()
    const cancel2 = vi.fn()
    registerCancellation('req-1', cancel1)
    registerCancellation('req-2', cancel2)
    cancelRequest('req-2')
    expect(cancel1).not.toHaveBeenCalled()
    expect(cancel2).toHaveBeenCalledOnce()
    unregisterCancellation('req-2')
  })
})
