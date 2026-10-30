import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { AgentCliKindSetting } from '@shared/types'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { useAgentCliKind } from '../useAgentCliKind'

const mockGet = vi.mocked(settingsApi.getAgentCliKind)
const mockSet = vi.mocked(settingsApi.setAgentCliKind)
let consoleErrorSpy: MockInstance<typeof console.error> | null = null

const SAVE_ERROR =
  '使うエージェント CLI を保存できませんでした: 設定ファイルを読み書きできませんでした。ほかのアプリで settings.json を開いていれば閉じてから、もう一度試してください。続くときはアプリのデータフォルダの settings.json が壊れていないか確かめてください'

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
})

afterEach(() => {
  consoleErrorSpy?.mockRestore()
  consoleErrorSpy = null
})

describe('useAgentCliKind', () => {
  it('読み込みが終わるまでは null、終わったら保存された種類と既定に戻した理由', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    const { result } = renderHook(() => useAgentCliKind())
    expect(result.current.kind).toBeNull()
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    expect(result.current.fallback).toBe('invalid-value')
  })

  it('読み込みの IPC が拒否されたら claude と read-failed にし、記録する(画面を止めない)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('ipc'))
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    expect(result.current.fallback).toBe('read-failed')
    expect(consoleErrorSpy).toHaveBeenCalled()
  })

  it('選んだらすぐ保存して表示を切り替え、既定に戻した旨を消す', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await expect(result.current.changeKind('copilot')).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledExactlyOnceWith('copilot')
    expect(result.current).toMatchObject({ kind: 'copilot', fallback: null, saveError: null })
  })

  it('不正な値(invalid-value)のときに同じ種類を選び直しても保存し、既定に戻した旨を消す', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await expect(result.current.changeKind('claude')).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledExactlyOnceWith('claude')
    expect(result.current).toMatchObject({ kind: 'claude', fallback: null, saveError: null })
  })

  it('保存に失敗したら保存の前の値に戻し、false を返して理由を出す(既定に戻した旨は残す。L-001)', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: 'read-failed' })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSet.mockRejectedValueOnce(new Error('disk full'))
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await expect(result.current.changeKind('copilot')).resolves.toBe(false)
    })
    expect(result.current).toMatchObject({
      kind: 'claude',
      fallback: 'read-failed',
      saveError: SAVE_ERROR
    })
  })

  it('保存に続けて失敗しても、2 回目も保存の前の値(読み込んだ値)に戻す(失敗した値を次の戻し先にしない)', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: null })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSet.mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(new Error('x'))
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    await act(async () => {
      await expect(result.current.changeKind('copilot')).resolves.toBe(false)
    })
    expect(result.current.kind).toBe('claude')
  })

  it('保存の失敗の文言に例外の文言を入れず、例外は記録だけする(壊れた settings.json の中身の断片を出さない。L-017)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: null })
    // settings.json が壊れていると、main の JSON.parse の SyntaxError(ファイルの中身の断片を含む)が IPC の拒否の文言に入る
    const err = new Error(
      `Error invoking remote method 'settings:setAgentCliKind': SyntaxError: Unexpected token 'x', "{"encryptedApiKey":"SECRET-CIPHER"x" is not valid JSON`
    )
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    expect(result.current.saveError).toBe(SAVE_ERROR)
    expect(result.current.saveError).not.toContain('SECRET-CIPHER')
    expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), err)
  })

  it('次の保存で失敗の文言を消す', async () => {
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: null })
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockSet.mockRejectedValueOnce(new Error('x')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    expect(result.current).toMatchObject({ kind: 'copilot', saveError: null })
  })

  it('読み込みの失敗 → 記録の文字列は完全一致で、見出しと例外の 2 引数', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const err = new Error('broken')
    mockGet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    expect(consoleErrorSpy).toHaveBeenCalledWith('[useAgentCliKind] getAgentCliKind failed:', err)
  })

  it('保存の失敗 → 記録の文字列は完全一致で、見出しと例外の 2 引数', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const err = new Error('broken')
    mockGet.mockResolvedValueOnce({ kind: 'claude', fallback: null })
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('claude'))
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    expect(consoleErrorSpy).toHaveBeenCalledWith('[useAgentCliKind] setAgentCliKind failed:', err)
  })

  it('アンマウントの後に読み込みが失敗する → 記録は 1 回', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    let rejectLoad: (err: Error) => void = () => undefined
    mockGet.mockReturnValueOnce(
      new Promise((_resolve, reject) => {
        rejectLoad = reject
      })
    )
    const { unmount } = renderHook(() => useAgentCliKind())
    unmount()
    await act(async () => {
      rejectLoad(new Error('broken'))
      await Promise.resolve()
    })
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
  })

  it('読み込みの完了の前に変更する → 後から届いた読み込みの結果が上書きする(今の振る舞い)', async () => {
    let resolveLoad: (loaded: AgentCliKindSetting) => void = () => undefined
    mockGet.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveLoad = resolve
      })
    )
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentCliKind())
    await act(async () => {
      await result.current.changeKind('copilot')
    })
    expect(result.current.kind).toBe('copilot')
    await act(async () => {
      resolveLoad({ kind: 'claude', fallback: null })
      await Promise.resolve()
    })
    expect(result.current.kind).toBe('claude')
  })

  it('3 回続けて変更し、最後の保存の成功の後で最初の保存が失敗する → 変更前の値へ戻す(今の振る舞い)', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockResolvedValueOnce({ kind: 'copilot', fallback: null })
    const first = deferred()
    const second = deferred()
    const third = deferred()
    mockSet
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
      .mockReturnValueOnce(third.promise)
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.kind).toBe('copilot'))
    let firstResult: Promise<boolean> = Promise.resolve(true)
    let secondResult: Promise<boolean> = Promise.resolve(true)
    let thirdResult: Promise<boolean> = Promise.resolve(true)
    act(() => {
      firstResult = result.current.changeKind('claude')
      secondResult = result.current.changeKind('copilot')
      thirdResult = result.current.changeKind('claude')
    })
    second.resolve()
    third.resolve()
    await act(async () => {
      await Promise.all([secondResult, thirdResult])
    })
    expect(result.current.kind).toBe('claude')
    first.reject(new Error('broken'))
    await act(async () => {
      await expect(firstResult).resolves.toBe(false)
    })
    // 最後に保存できたのは claude だが、画面は最初の変更の前の値に戻る
    expect(result.current.kind).toBe('copilot')
    expect(result.current.saveError).not.toBeNull()
  })

  it('読み込みが失敗して read-failed のとき、保存に失敗しても fallback が残る', async () => {
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('ipc'))
    mockSet.mockRejectedValueOnce(new Error('disk'))
    const { result } = renderHook(() => useAgentCliKind())
    await waitFor(() => expect(result.current.fallback).toBe('read-failed'))
    await act(async () => {
      await expect(result.current.changeKind('copilot')).resolves.toBe(false)
    })
    expect(result.current).toMatchObject({ kind: 'claude', fallback: 'read-failed' })
  })

  // StrictMode では effect が「実行 → 後始末 → 実行」と 2 回走る。最初の実行の読み込みは後始末で取り消され、遅れて届いても反映しない
  describe('取り消した読み込み(StrictMode の 1 回目の effect)', () => {
    function deferredSetting(): {
      promise: Promise<AgentCliKindSetting>
      resolve: (value: AgentCliKindSetting) => void
      reject: (err: Error) => void
    } {
      let resolve!: (value: AgentCliKindSetting) => void
      let reject!: (err: Error) => void
      const promise = new Promise<AgentCliKindSetting>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    it('遅れて届いた結果で、後の読み込みの種類と理由を上書きしない', async () => {
      const first = deferredSetting()
      mockGet
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ kind: 'copilot', fallback: null })
      const { result } = renderHook(() => useAgentCliKind(), { reactStrictMode: true })
      await waitFor(() => expect(result.current.kind).toBe('copilot'))
      expect(mockGet).toHaveBeenCalledTimes(2)

      await act(async () => {
        first.resolve({ kind: 'claude', fallback: 'invalid-value' })
      })

      expect(result.current).toMatchObject({ kind: 'copilot', fallback: null })
    })

    it('遅れて届いた失敗で、claude・read-failed に戻さない(失敗の記録だけはする)', async () => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const first = deferredSetting()
      mockGet
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ kind: 'copilot', fallback: null })
      const { result } = renderHook(() => useAgentCliKind(), { reactStrictMode: true })
      await waitFor(() => expect(result.current.kind).toBe('copilot'))

      const err = new Error('ipc')
      await act(async () => {
        first.reject(err)
      })

      expect(result.current).toMatchObject({ kind: 'copilot', fallback: null })
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.any(String), err)
    })

    it('取り消した読み込みの種類を、保存の失敗の戻し先にしない', async () => {
      consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const first = deferredSetting()
      mockGet
        .mockReturnValueOnce(first.promise)
        .mockResolvedValueOnce({ kind: 'copilot', fallback: null })
      mockSet.mockRejectedValueOnce(new Error('x'))
      const { result } = renderHook(() => useAgentCliKind(), { reactStrictMode: true })
      await waitFor(() => expect(result.current.kind).toBe('copilot'))
      await act(async () => {
        first.resolve({ kind: 'claude', fallback: null })
      })

      await act(async () => {
        await expect(result.current.changeKind('claude')).resolves.toBe(false)
      })

      expect(result.current.kind).toBe('copilot')
    })
  })
})
