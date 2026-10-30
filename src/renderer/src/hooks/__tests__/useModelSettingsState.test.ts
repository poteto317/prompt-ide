import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { useModelSettingsState } from '../useModelSettingsState'

const mockGetModelSettings = vi.mocked(settingsApi.getModelSettings)
const mockSetModelSettings = vi.mocked(settingsApi.setModelSettings)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetModelSettings.mockResolvedValue({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
  mockSetModelSettings.mockResolvedValue(undefined)
})

describe('useModelSettingsState', () => {
  it('初期状態はデフォルトのモデル設定で modelSettingsLoaded=false', () => {
    const { result } = renderHook(() => useModelSettingsState())
    expect(result.current.modelSettings).toEqual({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
    expect(result.current.modelSettingsLoaded).toBe(false)
  })

  it('mount 時に getModelSettings が呼ばれ modelSettings がセットされる', async () => {
    mockGetModelSettings.mockResolvedValue({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
    const { result } = renderHook(() => useModelSettingsState())
    await waitFor(() => expect(result.current.modelSettingsLoaded).toBe(true))
    expect(result.current.modelSettings).toEqual({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
    expect(mockGetModelSettings).toHaveBeenCalledOnce()
  })

  it('getModelSettings が reject したとき modelSettingsLoaded=true になりデフォルト値のまま', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetModelSettings.mockRejectedValue(new Error('failed'))
    const { result } = renderHook(() => useModelSettingsState())
    await waitFor(() => expect(result.current.modelSettingsLoaded).toBe(true))
    expect(result.current.modelSettings).toEqual({ modelId: 'claude-haiku-4-5', maxTokens: 4096 })
    consoleSpy.mockRestore()
  })

  it('getModelSettings が reject したとき console.error が呼ばれる', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetModelSettings.mockRejectedValue(new Error('failed'))
    const { result } = renderHook(() => useModelSettingsState())
    await waitFor(() => expect(result.current.modelSettingsLoaded).toBe(true))
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('saveModelSettings を呼ぶと setModelSettings IPC が呼ばれ modelSettings が更新される', async () => {
    const { result } = renderHook(() => useModelSettingsState())
    await waitFor(() => expect(result.current.modelSettingsLoaded).toBe(true))

    await act(async () => {
      await result.current.saveModelSettings({ modelId: 'claude-sonnet-5', maxTokens: 8192 })
    })
    expect(mockSetModelSettings).toHaveBeenCalledWith({
      modelId: 'claude-sonnet-5',
      maxTokens: 8192
    })
    expect(result.current.modelSettings).toEqual({ modelId: 'claude-sonnet-5', maxTokens: 8192 })
  })

  it('setModelSettings が reject したら、その拒否を呼び出し元へ返し、modelSettings は保存前のまま', async () => {
    mockGetModelSettings.mockResolvedValue({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
    const { result } = renderHook(() => useModelSettingsState())
    await waitFor(() => expect(result.current.modelSettingsLoaded).toBe(true))

    const failure = new Error('保存できませんでした')
    mockSetModelSettings.mockRejectedValueOnce(failure)
    let caught: unknown = null
    await act(async () => {
      try {
        await result.current.saveModelSettings({ modelId: 'claude-sonnet-5', maxTokens: 8192 })
      } catch (err) {
        caught = err
      }
    })
    expect(caught).toBe(failure)
    expect(result.current.modelSettings).toEqual({ modelId: 'claude-opus-4-8', maxTokens: 8000 })
  })
})
