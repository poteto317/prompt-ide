import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useDiffTabs, encodeDiffTabPath, isDiffTabPath, decodeDiffTabPath } from '../useDiffTabs'

describe('useDiffTabs', () => {
  it('openDiffTab で開いたタブが diffTabs に追加され、アクティブになる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'src/index.ts', staged: false })
    })
    expect(result.current.diffTabs).toEqual([{ path: 'src/index.ts', staged: false }])
    expect(result.current.activeDiffTab).toEqual({ path: 'src/index.ts', staged: false })
  })

  it('同じ path/staged のタブを再度開いても重複追加せず、アクティブにするだけ', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
      result.current.openDiffTab({ path: 'b.ts', staged: false })
      result.current.openDiffTab({ path: 'a.ts', staged: false })
    })
    expect(result.current.diffTabs).toHaveLength(2)
    expect(result.current.activeDiffTab).toEqual({ path: 'a.ts', staged: false })
  })

  it('同じ path で staged が異なる場合は別タブとして扱う', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
      result.current.openDiffTab({ path: 'a.ts', staged: true })
    })
    expect(result.current.diffTabs).toHaveLength(2)
  })

  it('closeDiffTab でタブが削除され、閉じたのがアクティブタブなら直前のタブがアクティブになる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
      result.current.openDiffTab({ path: 'b.ts', staged: false })
    })
    act(() => {
      result.current.closeDiffTab({ path: 'b.ts', staged: false })
    })
    expect(result.current.diffTabs).toEqual([{ path: 'a.ts', staged: false }])
    expect(result.current.activeDiffTab).toEqual({ path: 'a.ts', staged: false })
  })

  it('closeDiffTab で全タブを閉じると activeDiffTab は null になる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
    })
    act(() => {
      result.current.closeDiffTab({ path: 'a.ts', staged: false })
    })
    expect(result.current.diffTabs).toEqual([])
    expect(result.current.activeDiffTab).toBeNull()
  })

  it('activateDiffTab で指定したタブがアクティブになる', () => {
    const { result } = renderHook(() => useDiffTabs())
    act(() => {
      result.current.openDiffTab({ path: 'a.ts', staged: false })
      result.current.openDiffTab({ path: 'b.ts', staged: false })
      result.current.activateDiffTab({ path: 'a.ts', staged: false })
    })
    expect(result.current.activeDiffTab).toEqual({ path: 'a.ts', staged: false })
  })
})

describe('encodeDiffTabPath / isDiffTabPath / decodeDiffTabPath', () => {
  it('staged=false は diff:unstaged: プレフィックスでエンコードされる', () => {
    const encoded = encodeDiffTabPath({ path: 'src/index.ts', staged: false })
    expect(encoded).toBe('diff:unstaged:src/index.ts')
    expect(isDiffTabPath(encoded)).toBe(true)
    expect(decodeDiffTabPath(encoded)).toEqual({ path: 'src/index.ts', staged: false })
  })

  it('staged=true は diff:staged: プレフィックスでエンコードされる', () => {
    const encoded = encodeDiffTabPath({ path: 'src/index.ts', staged: true })
    expect(encoded).toBe('diff:staged:src/index.ts')
    expect(decodeDiffTabPath(encoded)).toEqual({ path: 'src/index.ts', staged: true })
  })

  it('実ファイルパスは isDiffTabPath が false を返す', () => {
    expect(isDiffTabPath('src/index.ts')).toBe(false)
  })
})
