// src/renderer/src/hooks/__tests__/useAgentPermissionAnswerCooldown.test.ts
import { act, renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useAgentPermissionAnswerCooldown } from '../useAgentPermissionAnswerCooldown'
import { AGENT_PERMISSION_ANSWER_COOLDOWN_MS } from '../../lib/agentPermissionAnswer'

// 待ちの長さの値(1,000ms)は agentPermissionAnswer.test.ts で固定し、ここでは定数を基準に境界を確かめる

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.clearAllTimers()
  vi.useRealTimers()
})

describe('useAgentPermissionAnswerCooldown', () => {
  it('始める前は、どのタブも待っていない', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    expect(result.current.isPending('slot-1')).toBe(false)
    expect(result.current.isPendingNow('slot-1')).toBe(false)
    expect(result.current.isInFlight('slot-1')).toBe(false)
    expect(result.current.isAwaitingReread('slot-1')).toBe(false)
  })

  it('begin で送っている途中・1,000ms・読み直し待ちが同時に始まる(ref は同期で、state は次の描画で)', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => {
      result.current.begin('slot-1')
      // 同じ同期の処理の中で読める(同期の再入の防止。L-101・L-653)
      expect(result.current.isInFlight('slot-1')).toBe(true)
      expect(result.current.isPendingNow('slot-1')).toBe(true)
    })
    expect(result.current.isPending('slot-1')).toBe(true)
    expect(result.current.isAwaitingReread('slot-1')).toBe(true)
    expect(result.current.isPending('slot-2')).toBe(false)
    expect(result.current.isAwaitingReread('slot-2')).toBe(false)
  })

  it('finish は送っている途中だけを解く(1,000ms と読み直し待ちは残る)', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    expect(result.current.isInFlight('slot-1')).toBe(false)
    expect(result.current.isAwaitingReread('slot-1')).toBe(true)
    expect(result.current.isPending('slot-1')).toBe(true)
    expect(result.current.isPendingNow('slot-1')).toBe(true)
  })

  it('markReread の前は、1,000ms を過ぎても待ちのまま', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    act(() => {
      vi.advanceTimersByTime(AGENT_PERMISSION_ANSWER_COOLDOWN_MS * 3)
    })
    expect(result.current.isPending('slot-1')).toBe(true)
    expect(result.current.isPendingNow('slot-1')).toBe(true)
    act(() => result.current.markReread('slot-1'))
    expect(result.current.isPending('slot-1')).toBe(false)
    expect(result.current.isPendingNow('slot-1')).toBe(false)
  })

  it('結果が 1,000ms より遅れ、読み直しが済んでも finish までは待ち(描画用・押した時点用の両方)', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => {
      vi.advanceTimersByTime(AGENT_PERMISSION_ANSWER_COOLDOWN_MS)
    })
    act(() => result.current.markReread('slot-1'))
    expect(result.current.isPendingNow('slot-1')).toBe(true)
    expect(result.current.isPending('slot-1')).toBe(true)
    act(() => result.current.finish('slot-1'))
    expect(result.current.isPendingNow('slot-1')).toBe(false)
    expect(result.current.isPending('slot-1')).toBe(false)
  })

  it('1,000ms の前に markReread しても、1,000ms までは待ち(999ms は待ち・1,000ms で明ける)', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    act(() => result.current.finish('slot-1'))
    act(() => result.current.markReread('slot-1'))
    expect(result.current.isAwaitingReread('slot-1')).toBe(false)
    act(() => {
      vi.advanceTimersByTime(AGENT_PERMISSION_ANSWER_COOLDOWN_MS - 1)
    })
    expect(result.current.isPending('slot-1')).toBe(true)
    expect(result.current.isPendingNow('slot-1')).toBe(true)
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(result.current.isPending('slot-1')).toBe(false)
    expect(result.current.isPendingNow('slot-1')).toBe(false)
  })

  it('待ちでないタブの markReread は何もしない(描画を増やさない)', () => {
    let renders = 0
    const { result } = renderHook(() => {
      renders++
      return useAgentPermissionAnswerCooldown()
    })
    const before = renders
    act(() => result.current.markReread('slot-1'))
    expect(renders).toBe(before)
  })

  it('待ちはタブごと(slot-1 の待ちの間も slot-2 は待っていない)', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    expect(result.current.isPendingNow('slot-2')).toBe(false)
    act(() => result.current.begin('slot-2'))
    act(() => result.current.markReread('slot-2'))
    act(() => result.current.finish('slot-2'))
    act(() => {
      vi.advanceTimersByTime(AGENT_PERMISSION_ANSWER_COOLDOWN_MS)
    })
    expect(result.current.isPending('slot-2')).toBe(false)
    expect(result.current.isPending('slot-1')).toBe(true)
  })

  it('begin・finish・markReread・isPendingNow・isInFlight の参照は描画をまたいで同じ', () => {
    const { result } = renderHook(() => useAgentPermissionAnswerCooldown())
    const first = result.current
    act(() => result.current.begin('slot-1'))
    expect(result.current.begin).toBe(first.begin)
    expect(result.current.finish).toBe(first.finish)
    expect(result.current.markReread).toBe(first.markReread)
    expect(result.current.isPendingNow).toBe(first.isPendingNow)
    expect(result.current.isInFlight).toBe(first.isInFlight)
  })

  it('アンマウントでタイマーを残さない', () => {
    const { result, unmount } = renderHook(() => useAgentPermissionAnswerCooldown())
    act(() => result.current.begin('slot-1'))
    expect(vi.getTimerCount()).toBe(1)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
