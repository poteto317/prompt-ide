import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useDiffOperations } from '../useDiffOperations'

const mockGetDiff = vi.mocked(gitApi.getDiff)
const mockStageHunk = vi.mocked(gitApi.stageHunk)
const mockUnstageHunk = vi.mocked(gitApi.unstageHunk)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('diff の取得', () => {
  it('activeDiffTab が設定されると getDiff を呼び、結果を diffContent にセットする', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))
    expect(mockGetDiff).toHaveBeenCalledWith('src/index.ts', false)
    expect(result.current.diffStaged).toBe(false)
    expect(result.current.diffError).toBeNull()
  })

  it('activeDiffTab が null のときは getDiff を呼ばない', () => {
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    renderHook(() => useDiffOperations(null, refreshGitStatus))
    expect(mockGetDiff).not.toHaveBeenCalled()
  })

  it('getDiff が失敗した場合、unhandled rejection にならず diffError がセットされる', async () => {
    mockGetDiff.mockRejectedValue(new Error('diff failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus))
    await waitFor(() => expect(result.current.diffError?.message).toBe('diff failed'))
  })
})

describe('stageHunk', () => {
  it('gitApi.stageHunk を activeDiffTab の path と patch で呼び、成功後 refreshGitStatus を呼ぶ', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockStageHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    expect(mockStageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH_TEXT')
    expect(refreshGitStatus).toHaveBeenCalled()
  })

  it('activeDiffTab が null のときは stageHunk を呼ばない', async () => {
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useDiffOperations(null, refreshGitStatus))
    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })
    expect(mockStageHunk).not.toHaveBeenCalled()
  })

  it('失敗した場合、unhandled rejection にならず diffError がセットされる', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockStageHunk.mockRejectedValue(new Error('apply failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.stageHunk('PATCH_TEXT')
    })

    expect(result.current.diffError?.message).toBe('apply failed')
  })

  it('実行中は isHunkOperationInProgress が true になり、2回目の呼び出しは stageHunk を呼ばない(多重実行防止)', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    let resolveStage: () => void = () => {}
    mockStageHunk.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // activeDiffTab はテスト内で安定した参照を保つ。renderHook のコールバック内で
    // 都度オブジェクトリテラルを作ると、無関係な再レンダーのたびに新しい参照になり、
    // effect の依存配列([activeDiffTab, ...])が変化を誤検知して diff を再取得してしまう
    // (成功時に diffError を null へ戻すため、直前に catch でセットしたエラーが消える)
    const activeTab = { path: 'src/index.ts', staged: false }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    let firstCall: Promise<void> = Promise.resolve()
    let secondCall: Promise<void> = Promise.resolve()
    act(() => {
      firstCall = result.current.stageHunk('PATCH_1')
    })
    expect(result.current.isHunkOperationInProgress).toBe(true)
    act(() => {
      secondCall = result.current.stageHunk('PATCH_2')
    })

    await act(async () => {
      resolveStage()
      await Promise.all([firstCall, secondCall])
    })

    expect(mockStageHunk).toHaveBeenCalledTimes(1)
    expect(mockStageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH_1')
    expect(result.current.isHunkOperationInProgress).toBe(false)
  })
})

describe('unstageHunk', () => {
  it('gitApi.unstageHunk を activeDiffTab の path と patch で呼ぶ', async () => {
    mockGetDiff.mockResolvedValue('DIFF_TEXT')
    mockUnstageHunk.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const activeTab = { path: 'src/index.ts', staged: true }
    const { result } = renderHook(() => useDiffOperations(activeTab, refreshGitStatus))
    await waitFor(() => expect(result.current.diffContent).toBe('DIFF_TEXT'))

    await act(async () => {
      await result.current.unstageHunk('PATCH_TEXT')
    })

    expect(mockUnstageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH_TEXT')
    expect(refreshGitStatus).toHaveBeenCalled()
  })
})
