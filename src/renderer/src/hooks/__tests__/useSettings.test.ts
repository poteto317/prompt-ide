import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/claudeApi')

import * as claudeApi from '../../lib/claudeApi'
import { useSettings } from '../useSettings'

const mockHasApiKey = vi.mocked(claudeApi.hasApiKey)
const mockSetApiKey = vi.mocked(claudeApi.setApiKey)

beforeEach(() => {
  vi.clearAllMocks()
  mockHasApiKey.mockResolvedValue(false)
  mockSetApiKey.mockResolvedValue(undefined)
})

describe('useSettings', () => {
  it('初期状態: hasKey=false, apiKeyLoaded=false', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current.hasKey).toBe(false)
    expect(result.current.apiKeyLoaded).toBe(false)
  })

  it('mount 時に hasApiKey が呼ばれ hasKey と apiKeyLoaded がセットされる（キーあり）', async () => {
    mockHasApiKey.mockResolvedValue(true)
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(true)
    expect(mockHasApiKey).toHaveBeenCalledOnce()
  })

  it('hasApiKey が false を返したとき hasKey=false で apiKeyLoaded=true になる', async () => {
    mockHasApiKey.mockResolvedValue(false)
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(false)
  })

  it('hasApiKey が reject したとき apiKeyLoaded=true になり hasKey=false のまま', async () => {
    mockHasApiKey.mockRejectedValue(new Error('keystore unavailable'))
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.hasKey).toBe(false)
    consoleSpy.mockRestore()
  })

  it('hasApiKey が reject したとき console.error が呼ばれる', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockHasApiKey.mockRejectedValue(new Error('keystore error'))
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
