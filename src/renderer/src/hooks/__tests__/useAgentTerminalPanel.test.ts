import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useAgentTerminalPanel } from '../useAgentTerminalPanel'

describe('useAgentTerminalPanel', () => {
  it('初期は開いていて、最大化していない', () => {
    const { result } = renderHook(() => useAgentTerminalPanel())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.isMaximized).toBe(false)
  })

  it('閉じると最大化も戻る', () => {
    const { result } = renderHook(() => useAgentTerminalPanel())
    act(() => result.current.toggleMaximized())
    act(() => result.current.toggleOpen())
    expect(result.current.isOpen).toBe(false)
    expect(result.current.isMaximized).toBe(false)
  })

  it('最大化は閉じていても開いてから行う', () => {
    const { result } = renderHook(() => useAgentTerminalPanel())
    act(() => result.current.toggleOpen())
    act(() => result.current.toggleMaximized())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.isMaximized).toBe(true)
  })

  it('open は閉じていれば開き、最大化は変えない', () => {
    const { result } = renderHook(() => useAgentTerminalPanel())
    act(() => result.current.toggleOpen())
    act(() => result.current.open())
    expect(result.current.isOpen).toBe(true)
    expect(result.current.isMaximized).toBe(false)
  })
})
