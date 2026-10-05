import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { useExternalChangeMarks } from '../useExternalChangeMarks'

describe('useExternalChangeMarks', () => {
  it('印を付け・読み・消す', () => {
    const { result } = renderHook(() => useExternalChangeMarks())
    act(() => result.current.mark('/p/a.ts', 'modified'))
    expect(result.current.get('/p/a.ts')).toBe('modified')
    act(() => result.current.mark('/p/a.ts', 'deleted'))
    expect(result.current.get('/p/a.ts')).toBe('deleted')
    act(() => result.current.clear('/p/a.ts'))
    expect(result.current.get('/p/a.ts')).toBeNull()
  })

  it('retain は一覧に無いパスの印を捨てる', () => {
    const { result } = renderHook(() => useExternalChangeMarks())
    act(() => {
      result.current.mark('/p/a.ts', 'modified')
      result.current.mark('/p/b.ts', 'modified')
    })
    act(() => result.current.retain(['/p/b.ts']))
    expect(result.current.get('/p/a.ts')).toBeNull()
    expect(result.current.get('/p/b.ts')).toBe('modified')
  })

  it('同じ印を付け直しても、変えないときは状態を作り直さない', () => {
    const { result } = renderHook(() => useExternalChangeMarks())
    act(() => result.current.mark('/p/a.ts', 'modified'))
    const before = result.current.get
    act(() => result.current.mark('/p/a.ts', 'modified'))
    act(() => result.current.retain(['/p/a.ts']))
    expect(result.current.get).toBe(before)
  })

  // 保存の照合で上書きをキャンセルしたときの依頼。受け手(useExternalFileChanges)が確かめて印を付ける
  it('確認の依頼は、受け手が登録されていればその受け手に渡し、印は直接付けない', () => {
    const { result } = renderHook(() => useExternalChangeMarks())
    const handler = vi.fn()
    act(() => {
      result.current.setCheckHandler(handler)
    })
    act(() => result.current.requestCheck('/p/a.ts', 'modified'))
    expect(handler).toHaveBeenCalledExactlyOnceWith('/p/a.ts')
    expect(result.current.get('/p/a.ts')).toBeNull()
  })

  it('受け手が無ければ(登録の解除の後も)、依頼の種類の印を直接付ける', () => {
    const { result } = renderHook(() => useExternalChangeMarks())
    act(() => result.current.requestCheck('/p/a.ts', 'deleted'))
    expect(result.current.get('/p/a.ts')).toBe('deleted')
    const handler = vi.fn()
    let unregister: () => void = () => undefined
    act(() => {
      unregister = result.current.setCheckHandler(handler)
    })
    act(() => unregister())
    act(() => result.current.requestCheck('/p/b.ts', 'modified'))
    expect(handler).not.toHaveBeenCalled()
    expect(result.current.get('/p/b.ts')).toBe('modified')
  })

  it('古い受け手の解除は、後から登録した受け手を外さない', () => {
    const { result } = renderHook(() => useExternalChangeMarks())
    const first = vi.fn()
    const second = vi.fn()
    let unregisterFirst: () => void = () => undefined
    act(() => {
      unregisterFirst = result.current.setCheckHandler(first)
      result.current.setCheckHandler(second)
    })
    act(() => unregisterFirst())
    act(() => result.current.requestCheck('/p/a.ts', 'modified'))
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledExactlyOnceWith('/p/a.ts')
  })
})
