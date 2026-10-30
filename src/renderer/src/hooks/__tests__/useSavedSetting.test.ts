import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import { SETTINGS_FILE_ERROR_REASON } from '../../lib/settingsMessages'
import { useSavedSetting } from '../useSavedSetting'
import type { UseSavedSettingOptions } from '../useSavedSetting'

interface Loaded {
  v: string
}

const PREFIX = '設定を保存できませんでした: '
const readValue = (loaded: Loaded): string => loaded.v

let consoleSpy: MockInstance<typeof console.error> | null = null

afterEach(() => {
  consoleSpy?.mockRestore()
  consoleSpy = null
})

function silenceConsole(): void {
  consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

function makeOptions(): UseSavedSettingOptions<string, Loaded> {
  return {
    load: vi.fn<() => Promise<Loaded>>().mockResolvedValue({ v: 'a' }),
    readValue,
    save: vi.fn<(next: string) => Promise<void>>().mockResolvedValue(undefined),
    defaultValue: 'def',
    saveErrorPrefix: PREFIX,
    loadLogLabel: 'load failed:',
    saveLogLabel: 'save failed:',
    onLoaded: vi.fn(),
    onLoadFailed: vi.fn(),
    onSaved: vi.fn()
  }
}

describe('useSavedSetting', () => {
  it('再描画を 2 回しても load は 1 回しか呼ばれない', async () => {
    const options = makeOptions()
    const { result, rerender } = renderHook(() => useSavedSetting(options))
    await waitFor(() => expect(result.current.value).toBe('a'))
    rerender()
    rerender()
    expect(options.load).toHaveBeenCalledTimes(1)
  })

  it('読み込みの成功 → onLoaded に結果がそのまま渡り、value は readValue の結果で、onLoadFailed は呼ばれない', async () => {
    const options = makeOptions()
    const loaded: Loaded = { v: 'loaded' }
    vi.mocked(options.load).mockResolvedValue(loaded)
    const { result } = renderHook(() => useSavedSetting(options))
    expect(result.current.value).toBeNull()
    await waitFor(() => expect(result.current.value).toBe('loaded'))
    expect(options.onLoaded).toHaveBeenCalledExactlyOnceWith(loaded)
    expect(options.onLoadFailed).not.toHaveBeenCalled()
  })

  it('読み込みの失敗 → onLoadFailed が 1 回呼ばれ、value は defaultValue', async () => {
    silenceConsole()
    const options = makeOptions()
    const err = new Error('broken')
    vi.mocked(options.load).mockRejectedValue(err)
    const { result } = renderHook(() => useSavedSetting(options))
    await waitFor(() => expect(result.current.value).toBe('def'))
    expect(options.onLoadFailed).toHaveBeenCalledTimes(1)
    expect(options.onLoaded).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith('load failed:', err)
  })

  it('アンマウントの後に読み込みが成功 → onLoaded を呼ばない', async () => {
    const options = makeOptions()
    let resolveLoad: (loaded: Loaded) => void = () => undefined
    vi.mocked(options.load).mockReturnValue(
      new Promise<Loaded>((resolve) => {
        resolveLoad = resolve
      })
    )
    const { unmount } = renderHook(() => useSavedSetting(options))
    unmount()
    await act(async () => {
      resolveLoad({ v: 'late' })
      await Promise.resolve()
    })
    expect(options.onLoaded).not.toHaveBeenCalled()
  })

  it('アンマウントの後に読み込みが失敗 → console.error は 1 回で、onLoadFailed は呼ばない', async () => {
    silenceConsole()
    const options = makeOptions()
    let rejectLoad: (err: Error) => void = () => undefined
    vi.mocked(options.load).mockReturnValue(
      new Promise<Loaded>((_resolve, reject) => {
        rejectLoad = reject
      })
    )
    const { unmount } = renderHook(() => useSavedSetting(options))
    unmount()
    await act(async () => {
      rejectLoad(new Error('late'))
      await Promise.resolve()
    })
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(options.onLoadFailed).not.toHaveBeenCalled()
  })

  it('保存の成功 → onSaved が 1 回呼ばれ、true を返す', async () => {
    const options = makeOptions()
    const { result } = renderHook(() => useSavedSetting(options))
    await waitFor(() => expect(result.current.value).toBe('a'))
    await act(async () => {
      await expect(result.current.change('b')).resolves.toBe(true)
    })
    expect(options.save).toHaveBeenCalledExactlyOnceWith('b')
    expect(options.onSaved).toHaveBeenCalledTimes(1)
    expect(result.current.value).toBe('b')
  })

  it('保存の失敗 → onSaved は呼ばず、value は変更の前の値で、saveError は固定の文言、戻り値は false', async () => {
    silenceConsole()
    const options = makeOptions()
    vi.mocked(options.save).mockRejectedValue(new Error('SECRET-FRAGMENT'))
    const { result } = renderHook(() => useSavedSetting(options))
    await waitFor(() => expect(result.current.value).toBe('a'))
    await act(async () => {
      await expect(result.current.change('b')).resolves.toBe(false)
    })
    expect(options.onSaved).not.toHaveBeenCalled()
    expect(result.current.value).toBe('a')
    expect(result.current.saveError).toBe(`${PREFIX}${SETTINGS_FILE_ERROR_REASON}`)
    expect(result.current.saveError).not.toContain('SECRET-FRAGMENT')
  })

  it('読み込みの失敗の後に保存が 2 回続けて失敗する → 既定値へ戻す', async () => {
    silenceConsole()
    const options = makeOptions()
    vi.mocked(options.load).mockRejectedValueOnce(new Error('x'))
    vi.mocked(options.save).mockRejectedValue(new Error('x'))
    const { result } = renderHook(() => useSavedSetting(options))
    await waitFor(() => expect(result.current.value).toBe('def'))
    await act(async () => {
      await result.current.change('b')
    })
    await act(async () => {
      await result.current.change('c')
    })
    expect(result.current.value).toBe('def')
  })

  it('保存の成功の後に保存が失敗する → 保存できた値へ戻す', async () => {
    silenceConsole()
    const options = makeOptions()
    const { result } = renderHook(() => useSavedSetting(options))
    await waitFor(() => expect(result.current.value).toBe('a'))
    await act(async () => {
      await result.current.change('b')
    })
    vi.mocked(options.save).mockRejectedValueOnce(new Error('x'))
    await act(async () => {
      await result.current.change('c')
    })
    expect(result.current.value).toBe('b')
  })

  it('保存が 2 回続けて失敗する → 最初の変更の前の値へ戻す', async () => {
    silenceConsole()
    const options = makeOptions()
    vi.mocked(options.save).mockRejectedValue(new Error('x'))
    const { result } = renderHook(() => useSavedSetting(options))
    await waitFor(() => expect(result.current.value).toBe('a'))
    await act(async () => {
      await result.current.change('b')
    })
    await act(async () => {
      await result.current.change('c')
    })
    expect(result.current.value).toBe('a')
  })

  it('次の保存を始めた時点で saveError が null に戻る', async () => {
    silenceConsole()
    const options = makeOptions()
    let resolveSave = (): void => undefined
    vi.mocked(options.save)
      .mockRejectedValueOnce(new Error('x'))
      .mockReturnValueOnce(
        new Promise<void>((resolve) => {
          resolveSave = resolve
        })
      )
    const { result } = renderHook(() => useSavedSetting(options))
    await waitFor(() => expect(result.current.value).toBe('a'))
    await act(async () => {
      await result.current.change('b')
    })
    expect(result.current.saveError).not.toBeNull()
    let pending: Promise<boolean> = Promise.resolve(false)
    act(() => {
      pending = result.current.change('c')
    })
    expect(result.current.saveError).toBeNull()
    await act(async () => {
      resolveSave()
      await pending
    })
  })
})
