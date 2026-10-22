import { describe, it, expect, vi } from 'vitest'
import { invokeForCurrentSession } from '../agentInterruptInvocation'

describe('invokeForCurrentSession', () => {
  it('結果が届いた時点で今のセッションなら done で結果を返す', async () => {
    await expect(
      invokeForCurrentSession(
        async () => ({ kind: 'sent' }),
        () => true
      )
    ).resolves.toEqual({ kind: 'done', result: { kind: 'sent' } })
  })

  it('結果が届いた時点で今のセッションでなければ stale(結果は捨てる)', async () => {
    await expect(
      invokeForCurrentSession(
        async () => ({ kind: 'sent' }),
        () => false
      )
    ).resolves.toEqual({ kind: 'stale' })
  })

  it('拒否は error で文言を返し、拒否しない', async () => {
    await expect(
      invokeForCurrentSession(
        () => Promise.reject(new Error('ipc down')),
        () => true
      )
    ).resolves.toEqual({ kind: 'error', message: 'ipc down' })
  })

  it('同期の例外も拒否と同じく error にする(L-055)', async () => {
    await expect(
      invokeForCurrentSession(
        () => {
          throw new Error('api missing')
        },
        () => true
      )
    ).resolves.toEqual({ kind: 'error', message: 'api missing' })
  })

  it('Error でない値の拒否は文字列にする', async () => {
    await expect(
      invokeForCurrentSession(
        () => Promise.reject('boom'),
        () => true
      )
    ).resolves.toEqual({ kind: 'error', message: 'boom' })
  })

  it('拒否が届いた時点で今のセッションでなければ stale(error を出さない)', async () => {
    await expect(
      invokeForCurrentSession(
        () => Promise.reject(new Error('ipc down')),
        () => false
      )
    ).resolves.toEqual({ kind: 'stale' })
  })

  it('isCurrent は呼び出しの前ではなく、結果が届いた後に確かめる', async () => {
    const order: string[] = []
    const isCurrent = vi.fn(() => {
      order.push('isCurrent')
      return true
    })
    await invokeForCurrentSession(async () => {
      order.push('call')
      return 1
    }, isCurrent)
    expect(order).toEqual(['call', 'isCurrent'])
  })
})
