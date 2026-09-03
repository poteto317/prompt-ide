import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitOperations } from '../useGitOperations'

const mockStageFile = vi.mocked(gitApi.stageFile)
const mockUnstageFile = vi.mocked(gitApi.unstageFile)
const mockCommitChanges = vi.mocked(gitApi.commitChanges)
const mockAmendCommit = vi.mocked(gitApi.amendCommit)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('stageFile', () => {
  it('gitApi.stageFile を呼び、完了後に refreshGitStatus を呼ぶ', async () => {
    mockStageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.stageFile('src/index.ts')
    })

    expect(mockStageFile).toHaveBeenCalledWith('src/index.ts')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('実行中は stagingPaths にそのパスを含む', async () => {
    let resolveStage: () => void = () => {}
    mockStageFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let stagePromise: Promise<void> = Promise.resolve()
    act(() => {
      stagePromise = result.current.stageFile('src/index.ts')
    })
    expect(result.current.stagingPaths.has('src/index.ts')).toBe(true)

    await act(async () => {
      resolveStage()
      await stagePromise
    })
    expect(result.current.stagingPaths.has('src/index.ts')).toBe(false)
  })

  it('同じパスへの多重呼び出しは stageFile を1回しか呼ばない', async () => {
    let resolveStage: () => void = () => {}
    mockStageFile.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveStage = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let firstCall: Promise<void> = Promise.resolve()
    let secondCall: Promise<void> = Promise.resolve()
    act(() => {
      firstCall = result.current.stageFile('src/index.ts')
      secondCall = result.current.stageFile('src/index.ts')
    })

    await act(async () => {
      resolveStage()
      await Promise.all([firstCall, secondCall])
    })
    expect(mockStageFile).toHaveBeenCalledTimes(1)
  })

  it('失敗した場合 operationError がセットされ、refreshGitStatus も呼ばれる', async () => {
    mockStageFile.mockRejectedValue(new Error('add failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.stageFile('src/index.ts')
    })

    expect(result.current.operationError?.message).toBe('add failed')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })
})

describe('unstageFile', () => {
  it('gitApi.unstageFile を呼び、完了後に refreshGitStatus を呼ぶ', async () => {
    mockUnstageFile.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    await act(async () => {
      await result.current.unstageFile('src/index.ts')
    })

    expect(mockUnstageFile).toHaveBeenCalledWith('src/index.ts')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })
})

describe('commit', () => {
  it('gitApi.commitChanges を呼び、成功時に true を返し refreshGitStatus を呼ぶ', async () => {
    mockCommitChanges.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitResult = false
    await act(async () => {
      commitResult = await result.current.commit('feat: 新機能')
    })

    expect(mockCommitChanges).toHaveBeenCalledWith('feat: 新機能')
    expect(commitResult).toBe(true)
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('失敗時は false を返し operationError をセットする', async () => {
    mockCommitChanges.mockRejectedValue(new Error('commit failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitResult = true
    await act(async () => {
      commitResult = await result.current.commit('msg')
    })

    expect(commitResult).toBe(false)
    expect(result.current.operationError?.message).toBe('commit failed')
  })

  it('実行中は isCommitting が true になる', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      commitPromise = result.current.commit('msg')
    })
    expect(result.current.isCommitting).toBe(true)

    await act(async () => {
      resolveCommit()
      await commitPromise
    })
    expect(result.current.isCommitting).toBe(false)
  })

  it('コミット中の多重呼び出しは commitChanges を1回しか呼ばない', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let first: Promise<boolean> = Promise.resolve(false)
    let second: Promise<boolean> = Promise.resolve(false)
    act(() => {
      first = result.current.commit('msg1')
      second = result.current.commit('msg2')
    })

    await act(async () => {
      resolveCommit()
      await Promise.all([first, second])
    })
    expect(mockCommitChanges).toHaveBeenCalledTimes(1)
  })
})

describe('amend', () => {
  it('gitApi.amendCommit を呼び、成功時に true を返し refreshGitStatus を呼ぶ', async () => {
    mockAmendCommit.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let amendResult = false
    await act(async () => {
      amendResult = await result.current.amend('feat: 修正後')
    })

    expect(mockAmendCommit).toHaveBeenCalledWith('feat: 修正後')
    expect(amendResult).toBe(true)
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('失敗時は false を返し operationError をセットする', async () => {
    mockAmendCommit.mockRejectedValue(new Error('amend failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let amendResult = true
    await act(async () => {
      amendResult = await result.current.amend('msg')
    })

    expect(amendResult).toBe(false)
    expect(result.current.operationError?.message).toBe('amend failed')
  })

  it('実行中は isCommitting が true になる', async () => {
    let resolveAmend: () => void = () => {}
    mockAmendCommit.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveAmend = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let amendPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      amendPromise = result.current.amend('msg')
    })
    expect(result.current.isCommitting).toBe(true)

    await act(async () => {
      resolveAmend()
      await amendPromise
    })
    expect(result.current.isCommitting).toBe(false)
  })

  it('commit 実行中の amend 呼び出しは amendCommit を呼ばない', async () => {
    let resolveCommit: () => void = () => {}
    mockCommitChanges.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCommit = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitOperations(refreshGitStatus))

    let commitPromise: Promise<boolean> = Promise.resolve(false)
    let amendPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      commitPromise = result.current.commit('msg1')
      amendPromise = result.current.amend('msg2')
    })

    await act(async () => {
      resolveCommit()
      await Promise.all([commitPromise, amendPromise])
    })
    expect(mockAmendCommit).not.toHaveBeenCalled()
  })
})
