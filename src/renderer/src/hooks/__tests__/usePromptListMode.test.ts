import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'
import type { PromptListMode } from '@shared/types'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { SETTINGS_FILE_ERROR_REASON } from '../../lib/settingsMessages'
import { PROMPT_LIST_MODE_SAVE_ERROR_PREFIX, usePromptListMode } from '../usePromptListMode'

const mockGet = vi.mocked(settingsApi.getPromptListMode)
const mockSet = vi.mocked(settingsApi.setPromptListMode)
let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
  consoleSpy = null
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('usePromptListMode', () => {
  it('読み込みが終わるまでは null、終わったら保存されたモード', async () => {
    mockGet.mockResolvedValueOnce('view')
    const { result } = renderHook(() => usePromptListMode())
    expect(result.current.mode).toBeNull()
    await waitFor(() => expect(result.current.mode).toBe('view'))
    expect(result.current.saveError).toBeNull()
  })

  it('読み込みに失敗したら既定(編集モード)で続け、見出しと例外の 2 引数で記録する', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const err = new Error('broken')
    mockGet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    expect(consoleSpy).toHaveBeenCalledExactlyOnceWith(
      '[usePromptListMode] getPromptListMode failed:',
      err
    )
  })

  it('onChange は保存の完了を待たずに切り替える(楽観的)', async () => {
    mockGet.mockResolvedValueOnce('edit')
    // 保存が終わらない間も、画面は新しいモードになっている
    mockSet.mockReturnValueOnce(new Promise<void>(() => undefined))
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    await act(async () => {
      result.current.onChange('view')
    })
    expect(result.current.mode).toBe('view')
    expect(mockSet).toHaveBeenCalledExactlyOnceWith('view')
  })

  it('保存に成功したらそのモードのままで、失敗の文言は出さない', async () => {
    mockGet.mockResolvedValueOnce('edit')
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    await act(async () => {
      result.current.onChange('view')
    })
    await waitFor(() => expect(mockSet).toHaveBeenCalledExactlyOnceWith('view'))
    expect(result.current.mode).toBe('view')
    expect(result.current.saveError).toBeNull()
  })

  it('保存に失敗したら直前のモードへ戻し、固定の文言を出して例外は記録だけする(L-017)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // main の設定ファイルの読み書きの例外には settings.json のパスや中身の断片が入りうる
    const err = new Error(
      "Error invoking remote method 'settings:setPromptListMode': Error: EACCES: permission denied, open '/Users/someone/Library/Application Support/prompt-ide/settings.json'"
    )
    mockGet.mockResolvedValueOnce('edit')
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    await act(async () => {
      result.current.onChange('view')
    })
    await waitFor(() =>
      expect(result.current.saveError).toBe(
        `モードの設定を保存できませんでした: ${SETTINGS_FILE_ERROR_REASON}`
      )
    )
    expect(result.current.mode).toBe('edit')
    expect(result.current.saveError).not.toContain('/Users/someone')
    expect(consoleSpy).toHaveBeenCalledWith('[usePromptListMode] setPromptListMode failed:', err)
  })

  it('保存の失敗の後、次の保存に成功したら失敗の文言を消す', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockResolvedValueOnce('view')
    mockSet.mockRejectedValueOnce(new Error('broken')).mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('view'))
    await act(async () => {
      result.current.onChange('edit')
    })
    await waitFor(() => expect(result.current.saveError).not.toBeNull())
    expect(result.current.mode).toBe('view')
    await act(async () => {
      result.current.onChange('edit')
    })
    await waitFor(() => expect(result.current.saveError).toBeNull())
    expect(result.current.mode).toBe('edit')
  })

  it('onChange は値を返さない(部品は保存の完了を待たない)', async () => {
    mockGet.mockResolvedValueOnce('edit')
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    let returned: unknown = 'not-called'
    await act(async () => {
      returned = result.current.onChange('view')
    })
    expect(returned).toBeUndefined()
  })

  it('onChange の参照は描画をまたいで変わらない', async () => {
    mockGet.mockResolvedValueOnce('edit')
    const { result, rerender } = renderHook(() => usePromptListMode())
    await waitFor(() => expect(result.current.mode).toBe('edit'))
    const first: (mode: PromptListMode) => void = result.current.onChange
    rerender()
    expect(result.current.onChange).toBe(first)
  })

  describe('保存の途中の操作(連打で画面と保存が食い違わない)', () => {
    interface Deferred {
      promise: Promise<void>
      resolve: () => void
      reject: (err: Error) => void
    }
    const createDeferred = (): Deferred => {
      let resolve: () => void = () => undefined
      let reject: (err: Error) => void = () => undefined
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    it('保存の途中に onChange を 2 回呼んでも、保存は 1 回しか始めない', async () => {
      mockGet.mockResolvedValueOnce('edit')
      mockSet.mockReturnValueOnce(createDeferred().promise)
      const { result } = renderHook(() => usePromptListMode())
      await waitFor(() => expect(result.current.mode).toBe('edit'))
      await act(async () => {
        result.current.onChange('view')
        result.current.onChange('edit')
      })
      expect(mockSet).toHaveBeenCalledExactlyOnceWith('view')
      expect(result.current.mode).toBe('view')
    })

    it('保存の途中は isSaving が true、終わると false', async () => {
      mockGet.mockResolvedValueOnce('edit')
      const deferred = createDeferred()
      mockSet.mockReturnValueOnce(deferred.promise)
      const { result } = renderHook(() => usePromptListMode())
      await waitFor(() => expect(result.current.mode).toBe('edit'))
      expect(result.current.isSaving).toBe(false)
      await act(async () => {
        result.current.onChange('view')
      })
      expect(result.current.isSaving).toBe(true)
      await act(async () => {
        deferred.resolve()
      })
      expect(result.current.isSaving).toBe(false)
    })

    it('保存に成功したら解除され、次の onChange が効く', async () => {
      mockGet.mockResolvedValueOnce('edit')
      mockSet.mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => usePromptListMode())
      await waitFor(() => expect(result.current.mode).toBe('edit'))
      await act(async () => {
        result.current.onChange('view')
      })
      expect(result.current.isSaving).toBe(false)
      await act(async () => {
        result.current.onChange('edit')
      })
      expect(mockSet).toHaveBeenNthCalledWith(1, 'view')
      expect(mockSet).toHaveBeenNthCalledWith(2, 'edit')
      expect(result.current.mode).toBe('edit')
    })

    it('保存に失敗したら直前のモードへ戻し、文言を出して解除され、次の onChange が効く', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mockGet.mockResolvedValueOnce('edit')
      const deferred = createDeferred()
      mockSet.mockReturnValueOnce(deferred.promise).mockResolvedValueOnce(undefined)
      const { result } = renderHook(() => usePromptListMode())
      await waitFor(() => expect(result.current.mode).toBe('edit'))
      await act(async () => {
        result.current.onChange('view')
      })
      await act(async () => {
        deferred.reject(new Error('broken'))
      })
      expect(result.current.mode).toBe('edit')
      expect(result.current.saveError).toBe(
        `モードの設定を保存できませんでした: ${SETTINGS_FILE_ERROR_REASON}`
      )
      expect(result.current.isSaving).toBe(false)
      await act(async () => {
        result.current.onChange('view')
      })
      expect(mockSet).toHaveBeenCalledTimes(2)
      expect(result.current.mode).toBe('view')
      expect(result.current.saveError).toBeNull()
    })

    it('連打の 2 回目は無視されるので、1 回目が失敗したら画面のモードは 1 回目の前の値に戻り、保存された値と食い違わない', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      mockGet.mockResolvedValueOnce('edit')
      const deferred = createDeferred()
      mockSet.mockReturnValueOnce(deferred.promise)
      const { result } = renderHook(() => usePromptListMode())
      await waitFor(() => expect(result.current.mode).toBe('edit'))
      await act(async () => {
        result.current.onChange('view')
        result.current.onChange('edit')
      })
      await act(async () => {
        deferred.reject(new Error('broken'))
      })
      // 保存されているのは最初の 'edit' のまま。画面も 'edit' で、失敗の文言が出ている
      expect(mockSet).toHaveBeenCalledTimes(1)
      expect(result.current.mode).toBe('edit')
      expect(result.current.saveError).toBe(
        `モードの設定を保存できませんでした: ${SETTINGS_FILE_ERROR_REASON}`
      )
    })
  })

  it('保存の失敗の接頭辞は、方向に依らない固定の文言(モードの名前を入れない)', () => {
    expect(PROMPT_LIST_MODE_SAVE_ERROR_PREFIX).toBe('モードの設定を保存できませんでした: ')
  })
})
