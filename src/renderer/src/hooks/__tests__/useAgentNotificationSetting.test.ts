import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import {
  AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX,
  useAgentNotificationSetting
} from '../useAgentNotificationSetting'

const mockGet = vi.mocked(settingsApi.getAgentNotificationsEnabled)
const mockSet = vi.mocked(settingsApi.setAgentNotificationsEnabled)
let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
  consoleSpy = null
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

describe('useAgentNotificationSetting', () => {
  it('読み込みが終わるまでは null、終わったら保存された設定', async () => {
    mockGet.mockResolvedValueOnce(false)
    const { result } = renderHook(() => useAgentNotificationSetting())
    expect(result.current.enabled).toBeNull()
    await waitFor(() => expect(result.current.enabled).toBe(false))
  })

  it('読み込みに失敗したら既定(オン)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('broken'))
    const { result } = renderHook(() => useAgentNotificationSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
  })

  it('変えたらすぐ反映して保存する', async () => {
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentNotificationSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledWith(false)
    expect(result.current.enabled).toBe(false)
    expect(result.current.saveError).toBeNull()
  })

  it('保存に失敗したら保存前の値に戻し、固定の理由を出して例外は記録だけする(L-017)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // main の設定ファイルの読み書きの例外には settings.json のパスや中身の断片が入りうる
    const err = new Error(
      "Error invoking remote method 'settings:setAgentNotificationsEnabled': Error: EACCES: permission denied, open '/Users/someone/Library/Application Support/prompt-ide/settings.json'"
    )
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useAgentNotificationSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(false)
    })
    expect(result.current.enabled).toBe(true)
    expect(result.current.saveError).toBe(
      '通知の設定を保存できませんでした: 設定ファイルを読み書きできませんでした'
    )
    expect(result.current.saveError).not.toContain('settings.json')
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), err)
  })

  describe('続けて変えたとき', () => {
    const deferred = (): {
      promise: Promise<void>
      resolve: () => void
      reject: (e: Error) => void
    } => {
      let resolve!: () => void
      let reject!: (e: Error) => void
      const promise = new Promise<void>((res, rej) => {
        resolve = res
        reject = rej
      })
      return { promise, resolve, reject }
    }

    const setup = async (): Promise<
      ReturnType<typeof renderHook<ReturnType<typeof useAgentNotificationSetting>, unknown>>
    > => {
      mockGet.mockResolvedValueOnce(true)
      const hook = renderHook(() => useAgentNotificationSetting())
      await waitFor(() => expect(hook.result.current.enabled).toBe(true))
      return hook
    }

    it('2 回とも失敗したら、最後に保存できた値(読み込んだ値)へ戻る', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const a = deferred()
      const b = deferred()
      mockSet.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
      const { result } = await setup()
      let pa!: Promise<boolean>
      let pb!: Promise<boolean>
      act(() => {
        pa = result.current.changeEnabled(false)
      })
      act(() => {
        pb = result.current.changeEnabled(true)
      })
      await act(async () => {
        a.reject(new Error('A'))
        await pa
      })
      // 後の変更が進行中なので戻さない
      expect(result.current.enabled).toBe(true)
      await act(async () => {
        b.reject(new Error('B'))
        await pb
      })
      // 保存できた値は読み込んだ true。B の直前の値(A の false)ではない
      expect(result.current.enabled).toBe(true)
      expect(result.current.saveError).toBe(
        '通知の設定を保存できませんでした: 設定ファイルを読み書きできませんでした'
      )
    })

    it('A 成功・B 失敗なら、A の値へ戻る', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const a = deferred()
      const b = deferred()
      mockSet.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
      const { result } = await setup()
      let pa!: Promise<boolean>
      let pb!: Promise<boolean>
      act(() => {
        pa = result.current.changeEnabled(false)
      })
      act(() => {
        pb = result.current.changeEnabled(true)
      })
      await act(async () => {
        a.resolve()
        await pa
      })
      await act(async () => {
        b.reject(new Error('B'))
        await pb
      })
      expect(result.current.enabled).toBe(false)
    })

    it('A 失敗・B 成功なら、B の値のまま', async () => {
      consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
      const a = deferred()
      const b = deferred()
      mockSet.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
      const { result } = await setup()
      let pa!: Promise<boolean>
      let pb!: Promise<boolean>
      act(() => {
        pa = result.current.changeEnabled(false)
      })
      act(() => {
        pb = result.current.changeEnabled(true)
      })
      await act(async () => {
        a.reject(new Error('A'))
        await pa
      })
      await act(async () => {
        b.resolve()
        await pb
      })
      expect(result.current.enabled).toBe(true)
      // 後の変更が保存できたので、先の変更の失敗の文言は出さない
      expect(result.current.saveError).toBeNull()
    })
  })

  it('保存の失敗の接頭辞', () => {
    expect(AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX).toBe('通知の設定を保存できませんでした: ')
  })
})
