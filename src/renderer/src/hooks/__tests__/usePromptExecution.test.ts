import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/promptInvoker')

import * as promptInvoker from '../../lib/promptInvoker'
import { usePromptExecution } from '../usePromptExecution'

const mockInvokePrompt = vi.mocked(promptInvoker.invokePrompt)

const context = { promptId: 'p1', promptTitle: 'タイトル' }

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
    mockInvokePrompt.mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvePrompt = resolve
        })
    )
    const { result } = renderHook(() => usePromptExecution())

    act(() => {
      result.current.executePrompt('プロンプト', null, 'claude')
    })
    expect(result.current.isExecuting).toBe(true)

    await act(async () => {
      resolvePrompt('回答')
    })
    expect(result.current.isExecuting).toBe(false)
  })

  it('executePrompt 完了後に result がセットされる', async () => {
    mockInvokePrompt.mockResolvedValue('回答テキスト')
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => {
      await result.current.executePrompt('プロンプト', null, 'claude')
    })
    expect(result.current.result).toBe('回答テキスト')
    expect(result.current.isExecuting).toBe(false)
    expect(result.current.executionError).toBeNull()
  })

  it('invokePrompt が throw したとき executionError にセットされる', async () => {
    mockInvokePrompt.mockRejectedValue(new Error('invoke error'))
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => {
      await result.current.executePrompt('プロンプト', null, 'claude')
    })
    expect(result.current.executionError).toBeInstanceOf(Error)
    expect(result.current.executionError?.message).toBe('invoke error')
    expect(result.current.result).toBeNull()
    expect(result.current.isExecuting).toBe(false)
  })

  it('invokePrompt が Error 以外を throw したとき Error に変換される', async () => {
    mockInvokePrompt.mockRejectedValue('string error')
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => {
      await result.current.executePrompt('プロンプト', null, 'claude')
    })
    expect(result.current.executionError).toBeInstanceOf(Error)
    expect(result.current.executionError?.message).toBe('string error')
  })

  it('clearResult で result と executionError が null にリセットされる', async () => {
    mockInvokePrompt.mockResolvedValue('回答テキスト')
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => {
      await result.current.executePrompt('プロンプト', null, 'claude')
    })
    expect(result.current.result).toBe('回答テキスト')

    act(() => {
      result.current.clearResult()
    })
    expect(result.current.result).toBeNull()
    expect(result.current.executionError).toBeNull()
  })

  it('先行実行の完了が後続実行の result を上書きしない（競合対策）', async () => {
    let resolveFirst!: (v: string) => void
    let resolveSecond!: (v: string) => void
    mockInvokePrompt
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockImplementationOnce(
        () =>
          new Promise<string>((resolve) => {
            resolveSecond = resolve
          })
      )

    const { result } = renderHook(() => usePromptExecution())

    act(() => {
      result.current.executePrompt('first', null, 'claude')
    })
    act(() => {
      result.current.executePrompt('second', null, 'claude')
    })

    await act(async () => {
      resolveFirst('first result')
    })
    expect(result.current.result).toBeNull()

    await act(async () => {
      resolveSecond('second result')
    })
    expect(result.current.result).toBe('second result')
    expect(result.current.isExecuting).toBe(false)
  })

  it('再実行前に前回の result / executionError がクリアされる', async () => {
    mockInvokePrompt.mockRejectedValueOnce(new Error('first error'))
    mockInvokePrompt.mockResolvedValueOnce('second result')
    const { result } = renderHook(() => usePromptExecution())

    await act(async () => {
      await result.current.executePrompt('p', null, 'claude')
    })
    expect(result.current.executionError?.message).toBe('first error')

    await act(async () => {
      await result.current.executePrompt('p', null, 'claude')
    })
    expect(result.current.executionError).toBeNull()
    expect(result.current.result).toBe('second result')
  })

  it('invokePrompt に toolId・promptContent・fileContent が正しく渡される', async () => {
    mockInvokePrompt.mockResolvedValue('result')
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => {
      await result.current.executePrompt('プロンプト', 'ファイル内容', 'copilot')
    })
    expect(mockInvokePrompt).toHaveBeenCalledWith('copilot', 'プロンプト', 'ファイル内容')
  })

  it('toolId が api（デフォルトツール）のときも fileContent が invokePrompt に渡される', async () => {
    mockInvokePrompt.mockResolvedValue('result')
    const { result } = renderHook(() => usePromptExecution())
    await act(async () => {
      await result.current.executePrompt('プロンプト', 'ファイル内容', 'api')
    })
    expect(mockInvokePrompt).toHaveBeenCalledWith('api', 'プロンプト', 'ファイル内容')
  })

  describe('onExecuted コールバック', () => {
    it('成功時、正しい status/resultText/errorMessage で呼ばれる', async () => {
      mockInvokePrompt.mockResolvedValue('回答テキスト')
      const onExecuted = vi.fn()
      const { result } = renderHook(() => usePromptExecution())
      await act(async () => {
        await result.current.executePrompt('プロンプト', 'ファイル', 'claude', context, onExecuted)
      })
      expect(onExecuted).toHaveBeenCalledWith(
        expect.objectContaining({
          promptId: 'p1',
          promptTitle: 'タイトル',
          promptContent: 'プロンプト',
          fileContent: 'ファイル',
          toolId: 'claude',
          status: 'success',
          resultText: '回答テキスト',
          errorMessage: null
        })
      )
      expect(typeof onExecuted.mock.calls[0][0].executedAt).toBe('number')
    })

    it('失敗時、status=error と errorMessage で呼ばれ resultText は null', async () => {
      mockInvokePrompt.mockRejectedValue(new Error('invoke error'))
      const onExecuted = vi.fn()
      const { result } = renderHook(() => usePromptExecution())
      await act(async () => {
        await result.current.executePrompt('プロンプト', null, 'claude', context, onExecuted)
      })
      expect(onExecuted).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          resultText: null,
          errorMessage: 'invoke error'
        })
      )
    })

    it('onExecuted を渡さなくてもエラーにならない', async () => {
      mockInvokePrompt.mockResolvedValue('回答')
      const { result } = renderHook(() => usePromptExecution())
      await expect(
        act(async () => {
          await result.current.executePrompt('プロンプト', null, 'claude')
        })
      ).resolves.not.toThrow()
    })

    it('context を省略しても onExecuted はデフォルト値で呼ばれる（履歴機能から疎結合）', async () => {
      mockInvokePrompt.mockResolvedValue('回答')
      const onExecuted = vi.fn()
      const { result } = renderHook(() => usePromptExecution())
      await act(async () => {
        await result.current.executePrompt('プロンプト', null, 'claude', undefined, onExecuted)
      })
      expect(onExecuted).toHaveBeenCalledWith(
        expect.objectContaining({ promptId: null, promptTitle: '' })
      )
    })

    it('後続実行に上書きされた（stale な）実行の onExecuted は呼ばれない', async () => {
      let resolveFirst!: (v: string) => void
      let resolveSecond!: (v: string) => void
      mockInvokePrompt
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveFirst = resolve
            })
        )
        .mockImplementationOnce(
          () =>
            new Promise<string>((resolve) => {
              resolveSecond = resolve
            })
        )

      const onExecutedFirst = vi.fn()
      const onExecutedSecond = vi.fn()
      const { result } = renderHook(() => usePromptExecution())

      act(() => {
        result.current.executePrompt('first', null, 'claude', context, onExecutedFirst)
      })
      act(() => {
        result.current.executePrompt('second', null, 'claude', context, onExecutedSecond)
      })

      await act(async () => {
        resolveFirst('first result')
      })
      expect(onExecutedFirst).not.toHaveBeenCalled()

      await act(async () => {
        resolveSecond('second result')
      })
      expect(onExecutedSecond).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'success', resultText: 'second result' })
      )
    })
  })
})
