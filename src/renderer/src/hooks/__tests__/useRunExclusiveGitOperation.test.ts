import { describe, it, expect, vi } from 'vitest'
import type { Mock } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRunExclusiveGitOperation } from '../useRunExclusiveGitOperation'

function setup(options: { refresh?: () => Promise<void> } = {}): {
  run: ReturnType<typeof useRunExclusiveGitOperation>
  calls: string[]
  refresh: Mock<() => Promise<void>>
  setError: Mock<(err: Error | null) => void>
  setBusy: Mock<(busy: boolean) => void>
  onStart: Mock<() => void>
  onEnd: Mock<() => void>
} {
  const calls: string[] = []
  const refresh = vi.fn(
    options.refresh ??
      (async () => {
        calls.push('refresh')
      })
  )
  const setError = vi.fn((err: Error | null) => {
    calls.push(err === null ? 'setError(null)' : 'setError(err)')
  })
  const setBusy = vi.fn((busy: boolean) => {
    calls.push(`setBusy(${busy})`)
  })
  const onStart = vi.fn(() => {
    calls.push('onStart')
  })
  const onEnd = vi.fn(() => {
    calls.push('onEnd')
  })
  const { result } = renderHook(() => useRunExclusiveGitOperation(refresh, setError))
  return { run: result.current, calls, refresh, setError, setBusy, onStart, onEnd }
}

describe('useRunExclusiveGitOperation', () => {
  it('isBusy が true → execute も setBusy も呼ばず false を返す', async () => {
    const t = setup()
    const execute = vi.fn().mockResolvedValue(undefined)
    const ok = await t.run({ isBusy: () => true, setBusy: t.setBusy, execute })
    expect(ok).toBe(false)
    expect(execute).not.toHaveBeenCalled()
    expect(t.setBusy).not.toHaveBeenCalled()
    expect(t.refresh).not.toHaveBeenCalled()
  })

  it('成功 → setBusy(true)・onStart・execute・setError(null)・refresh・setBusy(false)・onEnd の順で true を返す', async () => {
    const t = setup()
    const execute = vi.fn(async () => {
      t.calls.push('execute')
    })
    const ok = await t.run({
      isBusy: () => false,
      setBusy: t.setBusy,
      onStart: t.onStart,
      onEnd: t.onEnd,
      execute
    })
    expect(ok).toBe(true)
    expect(t.calls).toEqual([
      'setBusy(true)',
      'onStart',
      'execute',
      'setError(null)',
      'refresh',
      'setBusy(false)',
      'onEnd'
    ])
  })

  it('execute が Error で失敗 → その Error を setError へ渡し、refresh は呼び、false を返す', async () => {
    const t = setup()
    const failure = new Error('失敗')
    const ok = await t.run({
      isBusy: () => false,
      setBusy: t.setBusy,
      execute: () => Promise.reject(failure)
    })
    expect(ok).toBe(false)
    expect(t.setError).toHaveBeenCalledTimes(1)
    expect(t.setError).toHaveBeenCalledWith(failure)
    expect(t.refresh).toHaveBeenCalledTimes(1)
    expect(t.setBusy).toHaveBeenLastCalledWith(false)
  })

  it('execute が Error でない値で失敗 → toError の結果(Error)を setError へ渡す', async () => {
    const t = setup()
    const ok = await t.run({
      isBusy: () => false,
      setBusy: t.setBusy,
      execute: () => Promise.reject('文字列の失敗')
    })
    expect(ok).toBe(false)
    const passed = t.setError.mock.calls[0][0]
    expect(passed).toBeInstanceOf(Error)
    expect(passed?.message).toBe('文字列の失敗')
  })

  it('refresh が失敗しても例外を出さず、setBusy(false)・onEnd は呼び、成功した execute の結果は変えない', async () => {
    const t = setup({ refresh: () => Promise.reject(new Error('refresh 失敗')) })
    const ok = await t.run({
      isBusy: () => false,
      setBusy: t.setBusy,
      onEnd: t.onEnd,
      execute: async () => {}
    })
    expect(ok).toBe(true)
    expect(t.setError).toHaveBeenCalledTimes(1)
    expect(t.setError).toHaveBeenCalledWith(null)
    expect(t.setBusy).toHaveBeenLastCalledWith(false)
    expect(t.onEnd).toHaveBeenCalledTimes(1)
  })

  it('execute が失敗し refresh も失敗 → setError は execute の Error のまま上書きされない', async () => {
    const t = setup({ refresh: () => Promise.reject(new Error('refresh 失敗')) })
    const failure = new Error('execute 失敗')
    const ok = await t.run({
      isBusy: () => false,
      setBusy: t.setBusy,
      onEnd: t.onEnd,
      execute: () => Promise.reject(failure)
    })
    expect(ok).toBe(false)
    expect(t.setError).toHaveBeenCalledTimes(1)
    expect(t.setError).toHaveBeenCalledWith(failure)
    expect(t.onEnd).toHaveBeenCalledTimes(1)
  })

  it('onStart・onEnd を省略しても動く', async () => {
    const t = setup()
    const ok = await t.run({ isBusy: () => false, setBusy: t.setBusy, execute: async () => {} })
    expect(ok).toBe(true)
    expect(t.calls).toEqual(['setBusy(true)', 'setError(null)', 'refresh', 'setBusy(false)'])
  })
})
