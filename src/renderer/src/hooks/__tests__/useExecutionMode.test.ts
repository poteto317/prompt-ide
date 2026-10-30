import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { PromptExecutionMode } from '@shared/types'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { EXECUTION_MODE_SAVE_ERROR_PREFIX, useExecutionMode } from '../useExecutionMode'

const mockGet = vi.mocked(settingsApi.getPromptExecutionMode)
const mockSet = vi.mocked(settingsApi.setPromptExecutionMode)
let consoleSpy: MockInstance<typeof console.error> | null = null

function deferred(): {
  promise: Promise<void>
  resolve: () => void
  reject: (err: Error) => void
} {
  let resolve = (): void => undefined
  let reject: (err: Error) => void = () => undefined
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.resetAllMocks()
  consoleSpy = null
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('useExecutionMode', () => {
  it('読み込みが終わるまでは null、終わったら保存された方式', async () => {
    mockGet.mockResolvedValueOnce('legacy')
    const { result } = renderHook(() => useExecutionMode())
    expect(result.current.mode).toBeNull()
    await waitFor(() => expect(result.current.mode).toBe('legacy'))
  })

  it('読み込みに失敗したら既定(agent-cli)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('broken'))
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
  })

  it('選んだらすぐ保存し、表示を切り替える', async () => {
    mockGet.mockResolvedValueOnce('agent-cli')
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    await act(async () => {
      await expect(result.current.changeMode('legacy')).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledWith('legacy')
    expect(result.current.mode).toBe('legacy')
    expect(result.current.saveError).toBeNull()
  })

  it('保存に失敗したら保存前の値に戻し、固定の理由を出して例外は記録だけする(L-017)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // main の設定ファイルの読み書きの例外には settings.json のパスや中身の断片が入りうる
    const err = new Error(
      "Error invoking remote method 'settings:setPromptExecutionMode': Error: EACCES: permission denied, open '/Users/someone/Library/Application Support/prompt-ide/settings.json'"
    )
    mockGet.mockResolvedValueOnce('agent-cli')
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    await act(async () => {
      await expect(result.current.changeMode('legacy')).resolves.toBe(false)
    })
    expect(result.current.mode).toBe('agent-cli')
    expect(result.current.saveError).toBe(
      '実行方式を保存できませんでした: 設定ファイルを読み書きできませんでした。ほかのアプリで settings.json を開いていれば閉じてから、もう一度試してください。続くときはアプリのデータフォルダの settings.json が壊れていないか確かめてください'
    )
    // 文言は固定のファイル名(settings.json)だけを案内し、例外に入っていたパスは出さない
    expect(result.current.saveError).not.toContain('/Users/someone')
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), err)
  })

  it('読み込みの失敗 → 記録の文字列は完全一致で、見出しと例外の 2 引数', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const err = new Error('broken')
    mockGet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    expect(consoleSpy).toHaveBeenCalledTimes(1)
    expect(consoleSpy).toHaveBeenCalledWith(
      '[useExecutionMode] getPromptExecutionMode failed:',
      err
    )
  })

  it('保存の失敗 → 記録の文字列は完全一致で、見出しと例外の 2 引数', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const err = new Error('broken')
    mockGet.mockResolvedValueOnce('agent-cli')
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    await act(async () => {
      await result.current.changeMode('legacy')
    })
    expect(consoleSpy).toHaveBeenCalledWith(
      '[useExecutionMode] setPromptExecutionMode failed:',
      err
    )
  })

  it('アンマウントの後に読み込みが失敗する → 記録は 1 回', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let rejectLoad: (err: Error) => void = () => undefined
    mockGet.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectLoad = reject
      })
    )
    const { unmount } = renderHook(() => useExecutionMode())
    unmount()
    await act(async () => {
      rejectLoad(new Error('broken'))
      await Promise.resolve()
    })
    expect(consoleSpy).toHaveBeenCalledTimes(1)
  })

  it('読み込みの完了の前に変更する → 後から届いた読み込みの結果が上書きする(今の振る舞い)', async () => {
    let resolveLoad: (mode: PromptExecutionMode) => void = () => undefined
    mockGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve
      })
    )
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useExecutionMode())
    await act(async () => {
      await result.current.changeMode('legacy')
    })
    expect(result.current.mode).toBe('legacy')
    await act(async () => {
      resolveLoad('agent-cli')
      await Promise.resolve()
    })
    expect(result.current.mode).toBe('agent-cli')
  })

  it('3 回続けて変更し、最後の保存の成功の後で最初の保存が失敗する → 変更前の値へ戻す(今の振る舞い)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockResolvedValueOnce('agent-cli')
    const first = deferred()
    const second = deferred()
    const third = deferred()
    mockSet
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    let firstResult: Promise<boolean> = Promise.resolve(true)
    let secondResult: Promise<boolean> = Promise.resolve(true)
    let thirdResult: Promise<boolean> = Promise.resolve(true)
    act(() => {
      firstResult = result.current.changeMode('legacy')
      secondResult = result.current.changeMode('agent-cli')
      thirdResult = result.current.changeMode('legacy')
    })
    second.resolve()
    third.resolve()
    await act(async () => {
      await Promise.all([secondResult, thirdResult])
    })
    expect(result.current.mode).toBe('legacy')
    first.reject(new Error('broken'))
    await act(async () => {
      await expect(firstResult).resolves.toBe(false)
    })
    // 最後に保存できたのは legacy だが、画面は最初の変更の前の値に戻る
    expect(result.current.mode).toBe('agent-cli')
    expect(result.current.saveError).not.toBeNull()
  })

  it('保存の失敗の接頭辞', () => {
    expect(EXECUTION_MODE_SAVE_ERROR_PREFIX).toBe('実行方式を保存できませんでした: ')
  })

  // StrictMode では effect が「実行 → 後始末 → 実行」と 2 回走る。最初の実行の読み込みは後始末で取り消され、遅れて届いても反映しない
  describe('取り消した読み込み(StrictMode の 1 回目の effect)', () => {
    function deferredMode(): {
      promise: Promise<PromptExecutionMode>
      resolve: (value: PromptExecutionMode) => void
      reject: (err: Error) => void
    } {
      let resolve!: (value: PromptExecutionMode) => void
      let reject!: (err: Error) => void
      const promise = new Promise<PromptExecutionMode>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    it('遅れて届いた結果で、後の読み込みの方式を上書きしない', async () => {
      const first = deferredMode()
      mockGet.mockReturnValueOnce(first.promise).mockResolvedValueOnce('legacy')
      const { result } = renderHook(() => useExecutionMode(), { reactStrictMode: true })
      await waitFor(() => expect(result.current.mode).toBe('legacy'))
      expect(mockGet).toHaveBeenCalledTimes(2)

      await act(async () => {
        first.resolve('agent-cli')
      })

      expect(result.current.mode).toBe('legacy')
    })

    it('遅れて届いた失敗で、既定の方式に戻さない(失敗の記録だけはする)', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const first = deferredMode()
      mockGet.mockReturnValueOnce(first.promise).mockResolvedValueOnce('legacy')
      const { result } = renderHook(() => useExecutionMode(), { reactStrictMode: true })
      await waitFor(() => expect(result.current.mode).toBe('legacy'))

      const err = new Error('broken')
      await act(async () => {
        first.reject(err)
      })

      expect(result.current.mode).toBe('legacy')
      expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), err)
    })

    it('取り消した読み込みの方式を、保存の失敗の戻し先にしない', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const first = deferredMode()
      mockGet.mockReturnValueOnce(first.promise).mockResolvedValueOnce('legacy')
      mockSet.mockRejectedValueOnce(new Error('EACCES'))
      const { result } = renderHook(() => useExecutionMode(), { reactStrictMode: true })
      await waitFor(() => expect(result.current.mode).toBe('legacy'))
      await act(async () => {
        first.resolve('agent-cli')
      })

      await act(async () => {
        await expect(result.current.changeMode('agent-cli')).resolves.toBe(false)
      })

      expect(result.current.mode).toBe('legacy')
    })
  })
})
