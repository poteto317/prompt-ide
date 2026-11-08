import { describe, it, expect, vi, afterEach } from 'vitest'
import type { FolderChangeEvent } from '@shared/types'
import { FolderChangeCoalescer } from '../folderChangeCoalescer'

const WAIT_MS = 300
const MAX_WAIT_MS = 1_000

afterEach(() => {
  vi.useRealTimers()
})

function setup(send = vi.fn<(event: FolderChangeEvent) => void>()): {
  coalescer: FolderChangeCoalescer
  send: typeof send
} {
  const coalescer = new FolderChangeCoalescer({ waitMs: WAIT_MS, maxWaitMs: MAX_WAIT_MS, send })
  return { coalescer, send }
}

describe('FolderChangeCoalescer', () => {
  it('最後の通知から待って 1 回にまとめて送る', async () => {
    vi.useFakeTimers()
    const { coalescer, send } = setup()
    coalescer.add('git')
    await vi.advanceTimersByTimeAsync(200)
    coalescer.add('git')
    await vi.advanceTimersByTimeAsync(WAIT_MS - 1)
    expect(send).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(send).toHaveBeenCalledExactlyOnceWith({ treeChanged: false })
  })

  it('通知が続いても、最初の通知から上限で送る(L-399)', async () => {
    vi.useFakeTimers()
    const { coalescer, send } = setup()
    for (let elapsed = 0; elapsed < MAX_WAIT_MS; elapsed += 200) {
      coalescer.add('git')
      await vi.advanceTimersByTimeAsync(200)
    }
    expect(send).toHaveBeenCalledExactlyOnceWith({ treeChanged: false })
  })

  it('tree が 1 つでも混ざる → treeChanged: true', async () => {
    vi.useFakeTimers()
    const { coalescer, send } = setup()
    coalescer.add('git')
    coalescer.add('tree')
    coalescer.add('git')
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(send).toHaveBeenCalledExactlyOnceWith({ treeChanged: true })
  })

  it('ignore だけ → 予約せず送らない', async () => {
    vi.useFakeTimers()
    const { coalescer, send } = setup()
    coalescer.add('ignore')
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(send).not.toHaveBeenCalled()
  })

  it('送った後は未送信を消す(次の git だけ → treeChanged: false)', async () => {
    vi.useFakeTimers()
    const { coalescer, send } = setup()
    coalescer.add('tree')
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    coalescer.add('git')
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(send.mock.calls).toEqual([[{ treeChanged: true }], [{ treeChanged: false }]])
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancel → 予約と未送信を捨てる。その後の git だけ → treeChanged: false', async () => {
    vi.useFakeTimers()
    const { coalescer, send } = setup()
    coalescer.add('tree')
    coalescer.cancel()
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS)
    expect(send).not.toHaveBeenCalled()
    coalescer.add('git')
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(send).toHaveBeenCalledExactlyOnceWith({ treeChanged: false })
  })

  it('send が投げても、タイマーのコールバックは投げず、次の通知も送る', async () => {
    vi.useFakeTimers()
    const send = vi.fn<(event: FolderChangeEvent) => void>(() => {
      throw new Error('destroyed')
    })
    const { coalescer } = setup(send)
    coalescer.add('tree')
    await expect(vi.advanceTimersByTimeAsync(WAIT_MS)).resolves.not.toThrow()
    coalescer.add('git')
    await vi.advanceTimersByTimeAsync(WAIT_MS)
    expect(send).toHaveBeenCalledTimes(2)
  })
})
