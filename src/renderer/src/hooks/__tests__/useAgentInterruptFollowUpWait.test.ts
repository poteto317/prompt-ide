import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { useAgentInterruptFollowUpWait } from '../useAgentInterruptFollowUpWait'

describe('useAgentInterruptFollowUpWait', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.clearAllTimers()
    vi.useRealTimers()
  })

  it('afterMs を待ち終えたら true で解決する(それより前は解決しない)', async () => {
    const { result } = renderHook(() => useAgentInterruptFollowUpWait())
    const settled = vi.fn()
    void result.current(100).then(settled)
    await vi.advanceTimersByTimeAsync(99)
    expect(settled).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(settled).toHaveBeenCalledWith(true)
  })

  it('待っている間にアンマウントしたら、タイマーを消して false で解決する', async () => {
    const { result, unmount } = renderHook(() => useAgentInterruptFollowUpWait())
    const waited = result.current(100)
    unmount()
    await expect(waited).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('アンマウントの後に呼ばれたら、タイマーを足さずに false で解決する', async () => {
    const { result, unmount } = renderHook(() => useAgentInterruptFollowUpWait())
    const wait = result.current
    unmount()
    await expect(wait(100)).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('同時に待っている流れはそれぞれ解決し、アンマウントでまとめて false になる', async () => {
    const { result, unmount } = renderHook(() => useAgentInterruptFollowUpWait())
    const short = result.current(50)
    const long = result.current(300)
    await vi.advanceTimersByTimeAsync(50)
    await expect(short).resolves.toBe(true)
    unmount()
    await expect(long).resolves.toBe(false)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('描画し直しても同じ参照を返す', () => {
    const { result, rerender } = renderHook(() => useAgentInterruptFollowUpWait())
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
