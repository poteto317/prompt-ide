import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useSelectedTool, DEFAULT_CLI_TOOL } from '../useSelectedTool'

describe('useSelectedTool', () => {
  it('DEFAULT_CLI_TOOL は api（Claude API）で後方互換性を保つ', () => {
    expect(DEFAULT_CLI_TOOL).toBe('api')
  })

  it(`初期値は DEFAULT_CLI_TOOL (${DEFAULT_CLI_TOOL})`, () => {
    const { result } = renderHook(() => useSelectedTool())
    expect(result.current.selectedTool).toBe(DEFAULT_CLI_TOOL)
  })

  it('selectTool で selectedTool が変わる', () => {
    const { result } = renderHook(() => useSelectedTool())
    act(() => { result.current.selectTool('copilot') })
    expect(result.current.selectedTool).toBe('copilot')
  })

  it('claude に変更できる', () => {
    const { result } = renderHook(() => useSelectedTool())
    act(() => { result.current.selectTool('copilot') })
    act(() => { result.current.selectTool('claude') })
    expect(result.current.selectedTool).toBe('claude')
  })

  it('api に変更できる', () => {
    const { result } = renderHook(() => useSelectedTool())
    act(() => { result.current.selectTool('api') })
    expect(result.current.selectedTool).toBe('api')
  })

  it('selectTool の参照が安定している（再レンダー間で同一）', () => {
    const { result, rerender } = renderHook(() => useSelectedTool())
    const firstRef = result.current.selectTool
    rerender()
    expect(result.current.selectTool).toBe(firstRef)
  })
})
