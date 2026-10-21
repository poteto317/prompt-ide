import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { MockInstance } from 'vitest'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import {
  AGENT_SEND_CONFIRM_SETTING_SAVE_ERROR_PREFIX,
  useAgentSendConfirmSetting
} from '../useAgentSendConfirmSetting'

const mockGet = vi.mocked(settingsApi.getAgentSendConfirmEnabled)
const mockSet = vi.mocked(settingsApi.setAgentSendConfirmEnabled)
let consoleSpy: MockInstance<typeof console.error> | null = null

beforeEach(() => {
  vi.resetAllMocks()
  consoleSpy = null
})

afterEach(() => {
  consoleSpy?.mockRestore()
})

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

describe('useAgentSendConfirmSetting', () => {
  it('読み込みが終わるまでは null、終わったら保存された設定', async () => {
    mockGet.mockResolvedValueOnce(false)
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    expect(result.current.enabled).toBeNull()
    await waitFor(() => expect(result.current.enabled).toBe(false))
  })

  it('読み込みに失敗したら既定(オン)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('broken'))
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
  })

  it('変えたらすぐ反映して setAgentSendConfirmEnabled で保存する', async () => {
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledWith(false)
    expect(result.current.enabled).toBe(false)
    expect(result.current.saveError).toBeNull()
  })

  it('保存に失敗したら保存前の値に戻し、送信前の確認の接頭辞で固定の理由を出して例外は記録だけする(L-017)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // main の設定ファイルの読み書きの例外には settings.json のパスや中身の断片が入りうる
    const err = new Error(
      "Error invoking remote method 'settings:setAgentSendConfirmEnabled': Error: EACCES: permission denied, open '/Users/someone/Library/Application Support/prompt-ide/settings.json'"
    )
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockRejectedValueOnce(err)
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(false)
    })
    expect(result.current.enabled).toBe(true)
    expect(result.current.saveError).toBe(
      '送信前の確認の設定を保存できませんでした: 設定ファイルを読み書きできませんでした。ほかのアプリで settings.json を開いていれば閉じてから、もう一度試してください。続くときはアプリのデータフォルダの settings.json が壊れていないか確かめてください'
    )
    // 文言は固定のファイル名(settings.json)だけを案内し、例外に入っていたパスは出さない
    expect(result.current.saveError).not.toContain('/Users/someone')
    expect(consoleSpy).toHaveBeenCalledWith(expect.any(String), err)
  })

  it('続けて変えて、先が失敗・後が成功なら、後の値のまま失敗の文言を出さない(L-406)', async () => {
    consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const a = deferred()
    const b = deferred()
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockReturnValueOnce(a.promise).mockReturnValueOnce(b.promise)
    const { result } = renderHook(() => useAgentSendConfirmSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
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
    expect(result.current.saveError).toBeNull()
  })

  it('保存の失敗の接頭辞', () => {
    expect(AGENT_SEND_CONFIRM_SETTING_SAVE_ERROR_PREFIX).toBe(
      '送信前の確認の設定を保存できませんでした: '
    )
  })
})
