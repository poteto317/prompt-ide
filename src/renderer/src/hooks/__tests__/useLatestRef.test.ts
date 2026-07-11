import { renderHook } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const useLayoutEffectSpy = vi.hoisted(() => vi.fn())
const useEffectSpy = vi.hoisted(() => vi.fn())

vi.mock('react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react')>()
  return {
    ...actual,
    useLayoutEffect: (...args: Parameters<typeof actual.useLayoutEffect>) => {
      useLayoutEffectSpy(...args)
      return actual.useLayoutEffect(...args)
    },
    useEffect: (...args: Parameters<typeof actual.useEffect>) => {
      useEffectSpy(...args)
      return actual.useEffect(...args)
    }
  }
})

import { useLatestRef } from '../useLatestRef'

beforeEach(() => {
  useLayoutEffectSpy.mockClear()
  useEffectSpy.mockClear()
})

describe('useLatestRef', () => {
  // useEffect だとコミット後〜エフェクト実行までの間 .current が1レンダー古い
  // 値のままになり、その窓の間にユーザー操作（Cmd/Ctrl+S 等）が挟まると古い
  // クロージャが呼ばれてしまう（実際にレビューで指摘されたバグ）。
  // Testing Library の act() は useEffect/useLayoutEffect のどちらも同期的に
  // フラッシュしてしまうため、通常の挙動テストだけではこの2つを区別できない。
  // そのため実装が useLayoutEffect を使っていることを直接検証する。
  it('ref.current の更新に useLayoutEffect を使用している（useEffect への回帰防止）', () => {
    renderHook(() => useLatestRef('value'))

    expect(useLayoutEffectSpy).toHaveBeenCalled()
    expect(useEffectSpy).not.toHaveBeenCalled()
  })

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
