import { renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useLatestRef } from '../useLatestRef'

describe('useLatestRef', () => {
  it('初期値が .current に反映される', () => {
    const { result } = renderHook(() => useLatestRef('first'))
    expect(result.current.current).toBe('first')
  })

  it('rerender で値を変えると .current が最新値に更新される', () => {
    const { result, rerender } = renderHook(({ value }) => useLatestRef(value), {
      initialProps: { value: 'first' }
    })
    expect(result.current.current).toBe('first')

    rerender({ value: 'second' })
    expect(result.current.current).toBe('second')
  })

  it('返り値の ref オブジェクト自体は再レンダーをまたいで同一である', () => {
    const { result, rerender } = renderHook(({ value }) => useLatestRef(value), {
      initialProps: { value: 'first' }
    })
    const firstRef = result.current

    rerender({ value: 'second' })

    expect(result.current).toBe(firstRef)
  })
})
