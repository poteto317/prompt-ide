import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useOnChange } from '../useOnChange'

describe('useOnChange', () => {
  it('初回マウント時は onChange を呼ばない(初回は「変化」ではないため)', () => {
    const onChange = vi.fn()
    renderHook(() => useOnChange('a', onChange))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('value が変化すると onChange を呼ぶ', () => {
    const onChange = vi.fn()
    const { rerender } = renderHook(({ value }) => useOnChange(value, onChange), {
      initialProps: { value: 'a' }
    })
    rerender({ value: 'b' })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('value が同じまま再レンダーしても onChange を呼ばない', () => {
    const onChange = vi.fn()
    const { rerender } = renderHook(({ value }) => useOnChange(value, onChange), {
      initialProps: { value: 'a' }
    })
    rerender({ value: 'a' })
    expect(onChange).not.toHaveBeenCalled()
  })

  it('value が複数回変化すると、そのたびに onChange を呼ぶ', () => {
    const onChange = vi.fn()
    const { rerender } = renderHook(({ value }) => useOnChange(value, onChange), {
      initialProps: { value: 'a' }
    })
    rerender({ value: 'b' })
    rerender({ value: 'c' })
    expect(onChange).toHaveBeenCalledTimes(2)
  })
})
