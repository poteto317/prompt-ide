import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { usePanelState } from '../usePanelState'

describe('usePanelState', () => {
  it('初期状態: activePanel が explorer、sidebarOpen が true', () => {
    const { result } = renderHook(() => usePanelState())
    expect(result.current.activePanel).toBe('explorer')
    expect(result.current.sidebarOpen).toBe(true)
  })

  it('別パネルに切り替えると activePanel が変わり sidebarOpen は true を維持する', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.handlePanelChange('source-control'))
    expect(result.current.activePanel).toBe('source-control')
    expect(result.current.sidebarOpen).toBe(true)
  })

  it('同じパネルを再選択すると sidebarOpen が false にトグルする', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.handlePanelChange('explorer'))
    expect(result.current.activePanel).toBe('explorer')
    expect(result.current.sidebarOpen).toBe(false)
  })

  it('sidebarOpen が false の状態でさらに同じパネルを選択すると true に戻る', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.handlePanelChange('explorer'))
    act(() => result.current.handlePanelChange('explorer'))
    expect(result.current.sidebarOpen).toBe(true)
  })

  it('サイドバーが閉じた状態で別パネルを選択すると sidebarOpen が true になる', () => {
    const { result } = renderHook(() => usePanelState())
    act(() => result.current.handlePanelChange('explorer')) // close
    act(() => result.current.handlePanelChange('prompts'))  // switch → open
    expect(result.current.activePanel).toBe('prompts')
    expect(result.current.sidebarOpen).toBe(true)
  })
})
