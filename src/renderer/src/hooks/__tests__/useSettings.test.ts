import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/claudeApi')

import * as claudeApi from '../../lib/claudeApi'
import { useSettings } from '../useSettings'

const mockGetApiKey = vi.mocked(claudeApi.getApiKey)
const mockSetApiKey = vi.mocked(claudeApi.setApiKey)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetApiKey.mockResolvedValue(false)
  mockSetApiKey.mockResolvedValue(undefined)
})

describe('useSettings', () => {
  it('初期状態: hasKey=false, apiKeyLoaded=false', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current.hasKey).toBe(false)
    expect(result.current.apiKeyLoaded).toBe(false)
  })

  it('mount 時に getApiKey が呼ばれ hasKey と apiKeyLoaded がセットされる（キーあり）', async () => {
    mockGetApiKey.mockResolvedValue(true)
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(true)
    expect(mockGetApiKey).toHaveBeenCalledOnce()
  })

  it('getApiKey が false を返したとき hasKey=false で apiKeyLoaded=true になる', async () => {
    mockGetApiKey.mockResolvedValue(false)
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(false)
  })

  it('getApiKey が reject したとき apiKeyLoaded=true になり hasKey=false のまま', async () => {
    mockGetApiKey.mockRejectedValue(new Error('keystore unavailable'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(false)
    consoleSpy.mockRestore()
  })

  it('getApiKey が reject したとき console.error が呼ばれる', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetApiKey.mockRejectedValue(new Error('keystore error'))
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(consoleSpy).toHaveBeenCalledOnce()
    consoleSpy.mockRestore()
  })

  it('saveApiKey を呼ぶと setApiKey IPC が呼ばれ hasKey が true になる', async () => {
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))

    await act(async () => {
      await result.current.saveApiKey('sk-ant-new')
    })
    expect(mockSetApiKey).toHaveBeenCalledWith('sk-ant-new')
    expect(result.current.hasKey).toBe(true)
  })
})
