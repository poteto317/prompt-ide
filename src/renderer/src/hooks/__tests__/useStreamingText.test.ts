import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/promptStreamApi')

import * as promptStreamApi from '../../lib/promptStreamApi'
import { useStreamingText } from '../useStreamingText'

const mockOnPromptStreamChunk = vi.mocked(promptStreamApi.onPromptStreamChunk)

// setTimeout(50ms) で間引かれた streamingText の反映を待つ
const flushDebounce = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 100))

beforeEach(() => {
  vi.clearAllMocks()
  mockOnPromptStreamChunk.mockReturnValue(() => {})
})

describe('useStreamingText', () => {
  it('初期状態で streamingText は空文字', () => {
    const { result } = renderHook(() => useStreamingText())
    expect(result.current.streamingText).toBe('')
  })

  it('マウント時にチャンク購読し、アンマウントで解除する', () => {
    const unsubscribe = vi.fn()
    mockOnPromptStreamChunk.mockReturnValue(unsubscribe)
    const { unmount } = renderHook(() => useStreamingText())
    expect(mockOnPromptStreamChunk).toHaveBeenCalledOnce()
    unmount()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })

  it('startStreaming で指定した requestId に一致するチャンクが streamingText に追記される', async () => {
    const { result } = renderHook(() => useStreamingText())
    const listener = mockOnPromptStreamChunk.mock.calls[0][0]

    act(() => {
      result.current.startStreaming('req-1')
    })
    await act(async () => {
      listener('req-1', 'チャンク1')
      listener('req-1', 'チャンク2')
      await flushDebounce()
    })

    expect(result.current.streamingText).toBe('チャンク1チャンク2')
  })

  it('requestId が一致しないチャンクは無視される（遅延チャンクの最終防壁）', async () => {
    const { result } = renderHook(() => useStreamingText())
    const listener = mockOnPromptStreamChunk.mock.calls[0][0]

    act(() => {
      result.current.startStreaming('req-1')
    })
    await act(async () => {
      listener('stale-request-id', '無関係なチャンク')
      await flushDebounce()
    })

    expect(result.current.streamingText).toBe('')
  })

  it('startStreaming を呼んでいない状態で届いたチャンクは無視される', async () => {
    const { result } = renderHook(() => useStreamingText())
    const listener = mockOnPromptStreamChunk.mock.calls[0][0]
    await act(async () => {
      listener('any-request', 'チャンク')
      await flushDebounce()
    })
    expect(result.current.streamingText).toBe('')
  })

  it('stopStreaming を呼ぶと streamingText がクリアされる', async () => {
    const { result } = renderHook(() => useStreamingText())
    const listener = mockOnPromptStreamChunk.mock.calls[0][0]

    act(() => {
      result.current.startStreaming('req-1')
    })
    await act(async () => {
      listener('req-1', 'チャンク')
      await flushDebounce()
    })
    expect(result.current.streamingText).toBe('チャンク')

    act(() => {
      result.current.stopStreaming()
    })
    expect(result.current.streamingText).toBe('')
  })

  it('stopStreaming 後は同じ requestId のチャンクが届いても無視される', async () => {
    const { result } = renderHook(() => useStreamingText())
    const listener = mockOnPromptStreamChunk.mock.calls[0][0]

    act(() => {
      result.current.startStreaming('req-1')
    })
    act(() => {
      result.current.stopStreaming()
    })
    await act(async () => {
      listener('req-1', '遅延チャンク')
      await flushDebounce()
    })

    expect(result.current.streamingText).toBe('')
  })

  it('stopStreaming は保留中の flush タイマーをクリアする(次の実行への表示遅延の持ち越しを防ぐ)', async () => {
    const { result } = renderHook(() => useStreamingText())
    const listener = mockOnPromptStreamChunk.mock.calls[0][0]
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    act(() => {
      result.current.startStreaming('req-1')
    })
    act(() => {
      // このチャンクで flush タイマー(50ms後)が保留中になる
      listener('req-1', 'チャンク')
    })

    act(() => {
      result.current.stopStreaming()
    })

    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })

  it('startStreaming は前回の実行の保留中の flush タイマーをクリアする', async () => {
    const { result } = renderHook(() => useStreamingText())
    const listener = mockOnPromptStreamChunk.mock.calls[0][0]

    act(() => {
      result.current.startStreaming('req-1')
    })
    act(() => {
      // flush タイマーが保留中になる(stopStreaming を経由せず次の実行が始まるケース)
      listener('req-1', 'A')
    })

    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')
    act(() => {
      result.current.startStreaming('req-2')
    })
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()

    await act(async () => {
      listener('req-2', 'B')
      await flushDebounce()
    })
    // 前の実行(req-1)のテキストが残らず、req-2 のチャンクのみが反映される
    expect(result.current.streamingText).toBe('B')
  })

  it('startStreaming を再度呼ぶと前回のバッファがリセットされる', async () => {
    const { result } = renderHook(() => useStreamingText())
    const listener = mockOnPromptStreamChunk.mock.calls[0][0]

    act(() => {
      result.current.startStreaming('req-1')
    })
    await act(async () => {
      listener('req-1', '1回目')
      await flushDebounce()
    })
    expect(result.current.streamingText).toBe('1回目')

    act(() => {
      result.current.startStreaming('req-2')
    })
    await act(async () => {
      listener('req-2', '2回目')
      await flushDebounce()
    })
    expect(result.current.streamingText).toBe('2回目')
  })

  it('アンマウント時に保留中の flush タイマーをクリアする', async () => {
    const { result, unmount } = renderHook(() => useStreamingText())
    const listener = mockOnPromptStreamChunk.mock.calls[0][0]
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    act(() => {
      result.current.startStreaming('req-1')
    })
    act(() => {
      // このチャンクで flush タイマー(50ms後)が保留中になる
      listener('req-1', 'チャンク')
    })

    // アンマウント時に保留中のタイマーをクリアすること
    unmount()
    expect(clearTimeoutSpy).toHaveBeenCalled()
    clearTimeoutSpy.mockRestore()
  })
})
