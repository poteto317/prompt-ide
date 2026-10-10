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

  it('保存に失敗したら保存前の値に戻し、理由を出す', async () => {
    mockGet.mockResolvedValueOnce(true)
    mockSet.mockRejectedValueOnce(new Error('EACCES'))
    const { result } = renderHook(() => useAgentNotificationSetting())
    await waitFor(() => expect(result.current.enabled).toBe(true))
    await act(async () => {
      await expect(result.current.changeEnabled(false)).resolves.toBe(false)
    })
    expect(result.current.enabled).toBe(true)
    expect(result.current.saveError).toBe('通知の設定を保存できませんでした: EACCES')
  })

  it('保存の失敗の接頭辞', () => {
    expect(AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX).toBe('通知の設定を保存できませんでした: ')
  })
})
