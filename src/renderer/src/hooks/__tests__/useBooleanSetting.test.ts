import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { useBooleanSetting } from '../useBooleanSetting'
import type { BooleanSettingState, UseBooleanSettingOptions } from '../useBooleanSetting'

// 真偽値の設定の共通の hook。設定ごとの hook(useAgentNotificationSetting など)のテストは load・save を固定して渡すため、
// ここでは load が描画の途中で差し替わったときの読み込みの取り消しと、読み込みの前の保存の失敗を確かめる

let consoleSpy: MockInstance<typeof console.error> | null = null

afterEach(() => {
  consoleSpy?.mockRestore()
  consoleSpy = null
})

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: Error) => void
} {
  let resolve!: (value: T) => void
  let reject!: (err: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const SAVE_ERROR_PREFIX = '設定を保存できませんでした: '

function options(overrides: Partial<UseBooleanSettingOptions> = {}): UseBooleanSettingOptions {
  return {
    load: vi.fn(async () => true),
    save: vi.fn(async () => undefined),
    defaultValue: true,
    saveErrorPrefix: SAVE_ERROR_PREFIX,
    logLabel: '[useTestSetting]',
    ...overrides
  }
}

interface Rendered {
  result: { current: BooleanSettingState }
  rerender: (props: { opts: UseBooleanSettingOptions }) => void
  unmount: () => void
}

function renderSetting(initial: UseBooleanSettingOptions): Rendered {
  return renderHook(({ opts }: { opts: UseBooleanSettingOptions }) => useBooleanSetting(opts), {
    initialProps: { opts: initial }
  })
}

const failingSave = async (): Promise<void> => {
  throw new Error('EACCES')
}

describe('useBooleanSetting', () => {
  it('load が差し替わったら読み込み直し、前の load の遅れて届いた結果は反映しない', async () => {
    const first = deferred<boolean>()
    const firstLoad = vi.fn(() => first.promise)
    const secondLoad = vi.fn(async () => false)
    const { result, rerender } = renderSetting(options({ load: firstLoad }))
    rerender({ opts: options({ load: secondLoad }) })
    await waitFor(() => expect(result.current.enabled).toBe(false))

    await act(async () => {
      first.resolve(true)
    })

    expect(result.current.enabled).toBe(false)
    expect(firstLoad).toHaveBeenCalledOnce()
    expect(secondLoad).toHaveBeenCalledOnce()
  })

  it('前の load の遅れて届いた失敗は、既定値で上書きしない(失敗の記録だけはする)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const first = deferred<boolean>()
    const { result, rerender } = renderSetting(
      options({ load: () => first.promise, defaultValue: true })
    )
    rerender({ opts: options({ load: async () => false, defaultValue: true }) })
    await waitFor(() => expect(result.current.enabled).toBe(false))

    const err = new Error('stale')
    await act(async () => {
      first.reject(err)
    })

    expect(result.current.enabled).toBe(false)
    expect(consoleSpy).toHaveBeenCalledWith('[useTestSetting] load failed:', err)
  })

  it('取り消した読み込みの値は、保存の失敗の戻し先にもしない', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const first = deferred<boolean>()
    const { result, rerender } = renderSetting(
      options({ load: () => first.promise, save: failingSave })
    )
    rerender({ opts: options({ load: async () => false, save: failingSave }) })
    await waitFor(() => expect(result.current.enabled).toBe(false))
    await act(async () => {
      first.resolve(true)
    })

    await act(async () => {
      await expect(result.current.changeEnabled(true)).resolves.toBe(false)
    })

    // 戻し先は後の load が読んだ false(取り消した load の true ではない)
    expect(result.current.enabled).toBe(false)
    expect(result.current.saveError?.startsWith(SAVE_ERROR_PREFIX)).toBe(true)
  })

  it('読み込みの前に保存に失敗したら、読み込み前の null に戻す', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const pending = deferred<boolean>()
    const { result } = renderSetting(options({ load: () => pending.promise, save: failingSave }))

    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(false)
    })

    expect(result.current.enabled).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith('[useTestSetting] save failed:', expect.any(Error))
  })
})
