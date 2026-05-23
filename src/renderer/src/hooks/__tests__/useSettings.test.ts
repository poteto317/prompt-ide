import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/claudeApi')

import * as claudeApi from '../../lib/claudeApi'
import { useSettings } from '../useSettings'

const mockGetApiKey = vi.mocked(claudeApi.getApiKey)
const mockSetApiKey = vi.mocked(claudeApi.setApiKey)

beforeEach(() => {
  vi.clearAllMocks()
  mockGetApiKey.mockResolvedValue('')
  mockSetApiKey.mockResolvedValue(undefined)
})

describe('useSettings', () => {
  it('初期状態: apiKey="", apiKeyLoaded=false', () => {
    const { result } = renderHook(() => useSettings())
    expect(result.current.apiKey).toBe('')
    expect(result.current.apiKeyLoaded).toBe(false)
  })

  it('mount 時に getApiKey が呼ばれ apiKey と apiKeyLoaded がセットされる', async () => {
    mockGetApiKey.mockResolvedValue('sk-ant-test')
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.apiKey).toBe('sk-ant-test')
    expect(mockGetApiKey).toHaveBeenCalledOnce()
  })

  it('getApiKey が空文字を返したとき apiKey="" で apiKeyLoaded=true になる', async () => {
    mockGetApiKey.mockResolvedValue('')
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))
    expect(result.current.apiKey).toBe('')
  })

  it('saveApiKey を呼ぶと setApiKey IPC が呼ばれ apiKey state が更新される', async () => {
    const { result } = renderHook(() => useSettings())
    await waitFor(() => expect(result.current.apiKeyLoaded).toBe(true))

    await act(async () => {
      await result.current.saveApiKey('sk-ant-new')
    })
    expect(mockSetApiKey).toHaveBeenCalledWith('sk-ant-new')
    expect(result.current.apiKey).toBe('sk-ant-new')
  })
})
