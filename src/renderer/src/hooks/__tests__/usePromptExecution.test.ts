import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/claudeApi')

import * as claudeApi from '../../lib/claudeApi'
import { usePromptExecution } from '../usePromptExecution'

const mockRunPrompt = vi.mocked(claudeApi.runPrompt)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('usePromptExecution', () => {
  it('初期状態: isExecuting=false, result=null, executionError=null', () => {
    const { result } = renderHook(() => usePromptExecution())
    expect(result.current.isExecuting).toBe(false)
    expect(result.current.result).toBeNull()
    expect(result.current.executionError).toBeNull()
  })

  it('executePrompt 呼び出し中は isExecuting=true になる', async () => {
    let resolvePrompt!: (v: string) => void
    mockRunPrompt.mockImplementation(
      () => new Promise<string>((resolve) => { resolvePrompt = resolve })
    )
    const { result } = renderHook(() => usePromptExecution())

    act(() => { result.current.executePrompt('プロンプト', null) })
    expect(result.current.isExecuting).toBe(true)

    await act(async () => { resolvePrompt('回答') })
    expect(result.current.isExecuting).toBe(false)
  })

  it('executePrompt 完了後に result がセットされる', async () => {
    mockRunPrompt.mockResolvedValue('回答テキスト')
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => { await result.current.executePrompt('プロンプト', null) })
    expect(result.current.result).toBe('回答テキスト')
    expect(result.current.isExecuting).toBe(false)
    expect(result.current.executionError).toBeNull()
  })

  it('fileContent を渡すと runPrompt に転送される', async () => {
    mockRunPrompt.mockResolvedValue('result')
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => { await result.current.executePrompt('プロンプト', 'ファイル内容') })
    expect(mockRunPrompt).toHaveBeenCalledWith('プロンプト', 'ファイル内容')
  })

  it('runPrompt が throw したとき executionError にセットされる', async () => {
    mockRunPrompt.mockRejectedValue(new Error('api error'))
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => { await result.current.executePrompt('プロンプト', null) })
    expect(result.current.executionError).toBeInstanceOf(Error)
    expect(result.current.executionError?.message).toBe('api error')
    expect(result.current.result).toBeNull()
    expect(result.current.isExecuting).toBe(false)
  })

  it('runPrompt が Error 以外を throw したとき Error に変換される', async () => {
    mockRunPrompt.mockRejectedValue('string error')
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => { await result.current.executePrompt('プロンプト', null) })
    expect(result.current.executionError).toBeInstanceOf(Error)
    expect(result.current.executionError?.message).toBe('string error')
  })

  it('clearResult で result と executionError が null にリセットされる', async () => {
    mockRunPrompt.mockResolvedValue('回答テキスト')
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => { await result.current.executePrompt('プロンプト', null) })
    expect(result.current.result).toBe('回答テキスト')

    act(() => { result.current.clearResult() })
    expect(result.current.result).toBeNull()
    expect(result.current.executionError).toBeNull()
  })

  it('再実行前に前回の result / executionError がクリアされる', async () => {
    mockRunPrompt.mockRejectedValueOnce(new Error('first error'))
    mockRunPrompt.mockResolvedValueOnce('second result')
    const { result } = renderHook(() => usePromptExecution())

    await act(async () => { await result.current.executePrompt('p', null) })
    expect(result.current.executionError?.message).toBe('first error')

    await act(async () => { await result.current.executePrompt('p', null) })
    expect(result.current.executionError).toBeNull()
    expect(result.current.result).toBe('second result')
  })
})
