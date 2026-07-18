import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/claudeApi')
vi.mock('../../lib/settingsApi')

import * as claudeApi from '../../lib/claudeApi'
import * as settingsApi from '../../lib/settingsApi'
import { useSettings } from '../useSettings'

const mockHasApiKey = vi.mocked(claudeApi.hasApiKey)
const mockSetApiKey = vi.mocked(claudeApi.setApiKey)
const mockGetModelSettings = vi.mocked(settingsApi.getModelSettings)
const mockSetModelSettings = vi.mocked(settingsApi.setModelSettings)

beforeEach(() => {
  vi.clearAllMocks()
  mockHasApiKey.mockResolvedValue(false)
  mockSetApiKey.mockResolvedValue(undefined)
  mockGetModelSettings.mockResolvedValue({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
  mockSetModelSettings.mockResolvedValue(undefined)
})

// useSettings は useApiKeySettings + useModelSettingsState のオーケストレーターに縮小した。
// 各サブフックの詳細な挙動は useApiKeySettings.test.ts / useModelSettingsState.test.ts で
// 個別にテスト済みのため、ここでは「両方の結果が正しくマージされて返る」ことのみ確認する。
describe('useSettings', () => {
  it('APIキー設定とモデル設定の両方が単一のオブジェクトとして返る', async () => {
    mockHasApiKey.mockResolvedValue(true)
    mockGetModelSettings.mockResolvedValue({ modelId: 'claude-opus-4-8', maxTokens: 8000 })

    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    await waitFor(() => expect(result.current.modelSettingsLoaded).toBe(true))

    expect(result.current.hasKey).toBe(true)
    expect(result.current.modelSettings).toEqual({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
  })

  it('saveApiKey と saveModelSettings がそれぞれ独立して機能する', async () => {
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    await waitFor(() => expect(result.current.modelSettingsLoaded).toBe(true))

    await act(async () => {
      await result.current.saveApiKey('sk-ant-new')
    })
    expect(mockSetApiKey).toHaveBeenCalledWith('sk-ant-new')
    expect(result.current.hasKey).toBe(true)

    await act(async () => {
      await result.current.saveModelSettings({ modelId: 'claude-sonnet-5', maxTokens: 8192 })
    })
    expect(mockSetModelSettings).toHaveBeenCalledWith({
      modelId: 'claude-sonnet-5',
      maxTokens: 8192
    })
    expect(result.current.modelSettings).toEqual({ modelId: 'claude-sonnet-5', maxTokens: 8192 })
  })
})
