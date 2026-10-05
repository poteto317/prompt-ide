import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/settingsApi')

import * as settingsApi from '../../lib/settingsApi'
import { EXECUTION_MODE_SAVE_ERROR_PREFIX, useExecutionMode } from '../useExecutionMode'

const mockGet = vi.mocked(settingsApi.getPromptExecutionMode)
const mockSet = vi.mocked(settingsApi.setPromptExecutionMode)

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useExecutionMode', () => {
  it('読み込みが終わるまでは null、終わったら保存された方式', async () => {
    mockGet.mockResolvedValueOnce('legacy')
    const { result } = renderHook(() => useExecutionMode())
    expect(result.current.mode).toBeNull()
    await waitFor(() => expect(result.current.mode).toBe('legacy'))
  })

  it('読み込みに失敗したら既定(agent-cli)', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    mockGet.mockRejectedValueOnce(new Error('broken'))
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    consoleSpy.mockRestore()
  })

  it('選んだらすぐ保存し、表示を切り替える', async () => {
    mockGet.mockResolvedValueOnce('agent-cli')
    mockSet.mockResolvedValueOnce(undefined)
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    await act(async () => {
      await expect(result.current.changeMode('legacy')).resolves.toBe(true)
    })
    expect(mockSet).toHaveBeenCalledWith('legacy')
    expect(result.current.mode).toBe('legacy')
    expect(result.current.saveError).toBeNull()
  })

  it('保存に失敗したら保存前の値に戻し、理由を出す', async () => {
    mockGet.mockResolvedValueOnce('agent-cli')
    mockSet.mockRejectedValueOnce(new Error('EACCES'))
    const { result } = renderHook(() => useExecutionMode())
    await waitFor(() => expect(result.current.mode).toBe('agent-cli'))
    await act(async () => {
      await expect(result.current.changeMode('legacy')).resolves.toBe(false)
    })
    expect(result.current.mode).toBe('agent-cli')
    expect(result.current.saveError).toBe('実行方式を保存できませんでした: EACCES')
  })

  it('保存の失敗の接頭辞', () => {
    expect(EXECUTION_MODE_SAVE_ERROR_PREFIX).toBe('実行方式を保存できませんでした: ')
  })
})
