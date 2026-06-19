import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { usePromptVariablesForm } from '../usePromptVariablesForm'

function makeSubmitEvent(): React.FormEvent<HTMLFormElement> {
  return { preventDefault: vi.fn() } as unknown as React.FormEvent<HTMLFormElement>
}

describe('usePromptVariablesForm', () => {
  it('初期状態では values は空で isDisabled は true（変数が未入力）', () => {
    const { result } = renderHook(() => usePromptVariablesForm(['name'], vi.fn()))
    expect(result.current.values).toEqual({})
    expect(result.current.isDisabled).toBe(true)
  })

  it('handleChange で値が更新される', () => {
    const { result } = renderHook(() => usePromptVariablesForm(['name'], vi.fn()))
    act(() => result.current.handleChange('name', 'Alice'))
    expect(result.current.values).toEqual({ name: 'Alice' })
  })

  it('すべての変数が埋まるまで isDisabled は true', () => {
    const { result } = renderHook(() => usePromptVariablesForm(['a', 'b'], vi.fn()))
    act(() => result.current.handleChange('a', '1'))
    expect(result.current.isDisabled).toBe(true)
    act(() => result.current.handleChange('b', '2'))
    expect(result.current.isDisabled).toBe(false)
  })

  it('空白のみの値は未入力扱い（isDisabled は true）', () => {
    const { result } = renderHook(() => usePromptVariablesForm(['a'], vi.fn()))
    act(() => result.current.handleChange('a', '   '))
    expect(result.current.isDisabled).toBe(true)
  })

  it('handleSubmit で onSubmit が values とともに呼ばれ、preventDefault される', () => {
    const onSubmit = vi.fn()
    const { result } = renderHook(() => usePromptVariablesForm(['name'], onSubmit))
    act(() => result.current.handleChange('name', 'Alice'))
    const e = makeSubmitEvent()
    act(() => result.current.handleSubmit(e))
    expect(e.preventDefault).toHaveBeenCalled()
    expect(onSubmit).toHaveBeenCalledWith({ name: 'Alice' })
  })

  it('isDisabled のとき handleSubmit で onSubmit は呼ばれない', () => {
    const onSubmit = vi.fn()
    const { result } = renderHook(() => usePromptVariablesForm(['name'], onSubmit))
    act(() => result.current.handleSubmit(makeSubmitEvent()))
    expect(onSubmit).not.toHaveBeenCalled()
  })

  it('reset で values が空に戻る', () => {
    const { result } = renderHook(() => usePromptVariablesForm(['name'], vi.fn()))
    act(() => result.current.handleChange('name', 'Alice'))
    act(() => result.current.reset())
    expect(result.current.values).toEqual({})
  })
})
