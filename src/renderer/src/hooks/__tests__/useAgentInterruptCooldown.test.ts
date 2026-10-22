import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAgentInterruptCooldown } from '../useAgentInterruptCooldown'
import { AGENT_INTERRUPT_COOLDOWN_MS } from '../../lib/agentInterrupt'

// 待ちの長さの値(1,000ms)は agentInterrupt.test.ts で固定し、ここでは定数を基準に境界を確かめる

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useAgentInterruptCooldown', () => {
  it('始める前は、どのタブも待っていない', () => {
    const { result } = renderHook(() => useAgentInterruptCooldown())
    expect(result.current.isPending('slot-1')).toBe(false)
    expect(result.current.isInFlight('slot-1')).toBe(false)
    expect(result.current.isCoolingDown('slot-1')).toBe(false)
  })

  it('begin の直後は、ref(押した処理用)が同期で変わり、描画用も次の描画で変わる', () => {
    const { result } = renderHook(() => useAgentInterruptCooldown())
    act(() => {
      result.current.begin('slot-1')
      // 同じ同期の処理の中で読める(同期の再入の防止)
      expect(result.current.isInFlight('slot-1')).toBe(true)
      expect(result.current.isCoolingDown('slot-1')).toBe(true)
    })
    expect(result.current.isPending('slot-1')).toBe(true)
    expect(result.current.isPending('slot-2')).toBe(false)
  })

  it('finish で結果の待ちを解いても、AGENT_INTERRUPT_COOLDOWN_MS の待ちはタイマーが解くまで残る', () => {
    const { result } = renderHook(() => useAgentInterruptCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    expect(result.current.isInFlight('slot-1')).toBe(false)
    expect(result.current.isPending('slot-1')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    })
    expect(result.current.isCoolingDown('slot-1')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.isCoolingDown('slot-1')).toBe(false)
    expect(result.current.isPending('slot-1')).toBe(false)
  })

  it('AGENT_INTERRUPT_COOLDOWN_MS が過ぎても、結果が届く(finish)までは描画用は待ちのまま', () => {
    const { result } = renderHook(() => useAgentInterruptCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => {
      vi.advanceTimersByTime(AGENT_INTERRUPT_COOLDOWN_MS + 500)
    })
    expect(result.current.isCoolingDown('slot-1')).toBe(false)
    expect(result.current.isPending('slot-1')).toBe(true)
    act(() => result.current.finish('slot-1'))
    expect(result.current.isPending('slot-1')).toBe(false)
  })

  it('もう一度 begin すると、前の待ちのタイマーを消して数え直す', () => {
    const { result } = renderHook(() => useAgentInterruptCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    act(() => {
      vi.advanceTimersByTime(AGENT_INTERRUPT_COOLDOWN_MS / 2)
    })
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    expect(vi.getTimerCount()).toBe(1)
    // 前の待ちのタイマーが残っていれば、ここまでに解けている
    act(() => {
      vi.advanceTimersByTime(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    })
    expect(result.current.isPending('slot-1')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.isPending('slot-1')).toBe(false)
  })

  it('待ちはタブごと', () => {
    const { result } = renderHook(() => useAgentInterruptCooldown())
    act(() => result.current.begin('slot-1'))
    expect(result.current.isInFlight('slot-2')).toBe(false)
    expect(result.current.isCoolingDown('slot-2')).toBe(false)
    expect(result.current.isPending('slot-2')).toBe(false)
  })

  it('操作の関数は描画をまたいで同じ参照', () => {
    const { result } = renderHook(() => useAgentInterruptCooldown())
    const first = result.current
    act(() => result.current.begin('slot-1'))
    expect(result.current.isInFlight).toBe(first.isInFlight)
    expect(result.current.isCoolingDown).toBe(first.isCoolingDown)
    expect(result.current.begin).toBe(first.begin)
    expect(result.current.finish).toBe(first.finish)
    expect(result.current.restartCooldown).toBe(first.restartCooldown)
  })

  it('アンマウントでタブごとのタイマーをすべて消す', () => {
    const { result, unmount } = renderHook(() => useAgentInterruptCooldown())
    act(() => {
      result.current.begin('slot-1')
      result.current.begin('slot-2')
    })
    expect(vi.getTimerCount()).toBe(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('アンマウントの後に結果が届いて finish を呼んでも、投げず console にも出さない', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const { result, unmount } = renderHook(() => useAgentInterruptCooldown())
      act(() => result.current.begin('slot-1'))
      unmount()
      expect(() => result.current.finish('slot-1')).not.toThrow()
      expect(consoleErrorSpy).not.toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  it('restartCooldown はそのタブの待ちを今から数え直す(前のタイマーを消す。ref と描画の値の両方)', () => {
    const { result } = renderHook(() => useAgentInterruptCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    act(() => {
      vi.advanceTimersByTime(600)
    })
    act(() => result.current.restartCooldown('slot-1'))
    expect(vi.getTimerCount()).toBe(1)
    act(() => {
      vi.advanceTimersByTime(AGENT_INTERRUPT_COOLDOWN_MS - 1)
    })
    expect(result.current.isCoolingDown('slot-1')).toBe(true)
    expect(result.current.isPending('slot-1')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.isCoolingDown('slot-1')).toBe(false)
    expect(result.current.isPending('slot-1')).toBe(false)
  })

  it('restartCooldown はほかのタブの待ちを変えない', () => {
    const { result } = renderHook(() => useAgentInterruptCooldown())
    act(() => result.current.restartCooldown('slot-1'))
    expect(result.current.isCoolingDown('slot-1')).toBe(true)
    expect(result.current.isCoolingDown('slot-2')).toBe(false)
    expect(result.current.isPending('slot-2')).toBe(false)
  })

  it('アンマウントの後の restartCooldown はタイマーを残さない', () => {
    const { result, unmount } = renderHook(() => useAgentInterruptCooldown())
    unmount()
    result.current.restartCooldown('slot-1')
    expect(vi.getTimerCount()).toBe(0)
  })
})
