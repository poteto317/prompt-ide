import { renderHook, act } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useFileOperationLock } from '../useFileOperationLock'

describe('useFileOperationLock', () => {
  it('lock 前は isLocked が false を返す', () => {
    const { result } = renderHook(() => useFileOperationLock())
    expect(result.current.isLocked('a.ts')).toBe(false)
  })

  it('lock したパスは isLocked が true を返す', () => {
    const { result } = renderHook(() => useFileOperationLock())
    act(() => {
      result.current.lock('a.ts')
    })
    expect(result.current.isLocked('a.ts')).toBe(true)
  })

  it('unlock すると isLocked が false に戻る', () => {
    const { result } = renderHook(() => useFileOperationLock())
    act(() => {
      result.current.lock('a.ts')
    })
    act(() => {
      result.current.unlock('a.ts')
    })
    expect(result.current.isLocked('a.ts')).toBe(false)
  })

  it('別のパスの lock は影響しない', () => {
    const { result } = renderHook(() => useFileOperationLock())
    act(() => {
      result.current.lock('a.ts')
    })
    expect(result.current.isLocked('b.ts')).toBe(false)
  })

  it('Windows パスの大文字小文字違いは同一ファイルとして扱う(表記違いでロックがすり抜けない)', () => {
    // useDiffOperations.ts(ハンク単位の git apply --cached)と
    // useGitOperations.ts(ファイル全体の git add/reset)は同じロックを共有して
    // 同一ファイルへの同時書き込みを防ぐが、渡す path の出所が異なる
    // (activeDiffTab.path と gitStatusFiles 由来)。生の文字列比較のままだと、
    // 大文字小文字だけ異なる表記(Windows は大文字小文字を区別しない)が来た
    // 場合に別ファイル扱いされ、排他制御が効かず .git/index への同時書き込みが
    // 競合してしまう
    const { result } = renderHook(() => useFileOperationLock())
    act(() => {
      result.current.lock('C:\\project\\a.ts')
    })
    expect(result.current.isLocked('c:\\project\\A.ts')).toBe(true)
  })

  it('何もロックされていない状態では isAnyLocked が false を返す', () => {
    const { result } = renderHook(() => useFileOperationLock())
    expect(result.current.isAnyLocked()).toBe(false)
  })

  it('いずれかのパスがロックされていれば isAnyLocked が true を返す', () => {
    // useGitOperations.ts の commit は特定のパスではなく git.index 全体を
    // 書き換えるため、「どれか1つでもハンク操作(git apply --cached)が
    // 実行中か」を path 指定なしで判定する必要がある
    const { result } = renderHook(() => useFileOperationLock())
    act(() => {
      result.current.lock('a.ts')
    })
    expect(result.current.isAnyLocked()).toBe(true)
  })

  it('lockGlobal 前は isLocked が false を返す', () => {
    const { result } = renderHook(() => useFileOperationLock())
    expect(result.current.isLocked('a.ts')).toBe(false)
  })

  it('lockGlobal すると、どのパスを渡しても isLocked が true を返す', () => {
    // git commit の実行中は git.index 全体が書き換わるため、個別パスの
    // ハンク操作(git apply --cached)もすべて弾く必要がある。個別パスの
    // ロックと違い、対象パスを問わない全体ロックとして扱う
    const { result } = renderHook(() => useFileOperationLock())
    act(() => {
      result.current.lockGlobal()
    })
    expect(result.current.isLocked('a.ts')).toBe(true)
    expect(result.current.isLocked('b.ts')).toBe(true)
  })

  it('unlockGlobal すると isLocked が false に戻る', () => {
    const { result } = renderHook(() => useFileOperationLock())
    act(() => {
      result.current.lockGlobal()
    })
    act(() => {
      result.current.unlockGlobal()
    })
    expect(result.current.isLocked('a.ts')).toBe(false)
  })
})
