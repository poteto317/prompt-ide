import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitRemoteSetup } from '../useGitRemoteSetup'
import type { FileOperationLock } from '../useFileOperationLock'

const mockInitRepository = vi.mocked(gitApi.initRepository)
const mockAddOrigin = vi.mocked(gitApi.addOrigin)

const notRepo: GitStatusResult = {
  isRepo: false,
  branch: null,
  ahead: 0,
  behind: 0,
  files: [],
  mergeInProgress: false,
  hasOrigin: false,
  hasRemote: false,
  upstream: null,
  detached: false
}
const repoWithoutOrigin: GitStatusResult = { ...notRepo, isRepo: true, branch: 'main' }

const makeFileLock = (overrides: Partial<FileOperationLock> = {}): FileOperationLock => ({
  isLocked: vi.fn().mockReturnValue(false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn().mockReturnValue(false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn(),
  ...overrides
})

const setup = (
  gitStatus: GitStatusResult | null,
  lock: FileOperationLock = makeFileLock()
): ReturnType<typeof renderHook<ReturnType<typeof useGitRemoteSetup>, unknown>> & {
  refreshGitStatus: ReturnType<typeof vi.fn<() => Promise<void>>>
  refreshHistory: ReturnType<typeof vi.fn<() => Promise<void>>>
} => {
  const refreshGitStatus = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const refreshHistory = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const hook = renderHook(() =>
    useGitRemoteSetup(gitStatus, refreshGitStatus, refreshHistory, lock)
  )
  return Object.assign(hook, { refreshGitStatus, refreshHistory })
}

// 保留させ、解決・失敗を後から起こせるようにする
const hold = (
  mock: typeof mockInitRepository | typeof mockAddOrigin
): { resolve: () => void; reject: (err: Error) => void } => {
  const handlers: { resolve: () => void; reject: (err: Error) => void } = {
    resolve: () => {},
    reject: () => {}
  }
  mock.mockImplementationOnce(
    () =>
      new Promise<void>((resolve, reject) => {
        handlers.resolve = () => resolve()
        handlers.reject = reject
      })
  )
  return { resolve: () => handlers.resolve(), reject: (err) => handlers.reject(err) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockInitRepository.mockReset()
  mockAddOrigin.mockReset()
})

describe('initRepository', () => {
  it('gitApi.initRepository を呼び、ステータスと履歴を取り直して true を返す', async () => {
    mockInitRepository.mockResolvedValue(undefined)
    const { result, refreshGitStatus, refreshHistory } = setup(notRepo)
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.initRepository('develop')
    })
    expect(succeeded).toBe(true)
    expect(mockInitRepository).toHaveBeenCalledWith('develop')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
    expect(result.current.isInitializing).toBe(false)
    expect(result.current.initError).toBeNull()
  })

  it('失敗は initError に入れて false を返し、取り直しはする', async () => {
    mockInitRepository.mockRejectedValue(new Error('ブランチ名として使用できない名前です: a..b'))
    const { result, refreshGitStatus, refreshHistory } = setup(notRepo)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.initRepository('a..b')
    })
    expect(succeeded).toBe(false)
    expect(result.current.initError?.message).toBe('ブランチ名として使用できない名前です: a..b')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // 実行中フラグは取り直しの後で下ろす(下ろしてから取り直すと、古い表示のまま押せてしまう。パターン 73)
  it('取り直しが終わるまで isInitializing は true のまま', async () => {
    mockInitRepository.mockResolvedValue(undefined)
    const { result, refreshGitStatus } = setup(notRepo)
    let resolveRefresh: () => void = () => {}
    refreshGitStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.initRepository('main')
    })
    await waitFor(() => expect(refreshGitStatus).toHaveBeenCalled())
    expect(result.current.isInitializing).toBe(true)
    await act(async () => {
      resolveRefresh()
      await promise
    })
    expect(result.current.isInitializing).toBe(false)
  })

  // 履歴の取り直しが先に失敗しても、ステータスの取り直しを待ってから実行中フラグを下ろす。Promise.all では
  // 先に失敗した時点で下ろしてしまい、Git 管理外の表示のまま「リポジトリを初期化」を押せる(パターン 73)
  it('履歴の取り直しが即失敗しても、ステータスの取り直しが終わるまで isInitializing は true のまま', async () => {
    mockInitRepository.mockResolvedValue(undefined)
    const { result, refreshGitStatus, refreshHistory } = setup(notRepo)
    let resolveStatus: () => void = () => {}
    refreshGitStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStatus = resolve
        })
    )
    refreshHistory.mockRejectedValueOnce(new Error('履歴の取得に失敗'))
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.initRepository('main')
    })
    await waitFor(() => expect(refreshHistory).toHaveBeenCalled())
    // 履歴の失敗が処理されるまで待つ(Promise.all なら、ここで実行中フラグが下りる)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.isInitializing).toBe(true)
    let second = true
    await act(async () => {
      second = await result.current.initRepository('main')
    })
    expect(second).toBe(false)
    expect(mockInitRepository).toHaveBeenCalledOnce()
    let succeeded = false
    await act(async () => {
      resolveStatus()
      succeeded = await promise
    })
    expect(succeeded).toBe(true)
    expect(result.current.isInitializing).toBe(false)
  })

  // 取り直しの失敗で、成功した初期化を失敗にしない(パターン 52)
  it.each([
    ['ステータス', 'status'],
    ['履歴', 'history']
  ] as const)(
    '%sの取り直しが失敗しても、成功として true を返しエラーを出さない',
    async (_label, which) => {
      mockInitRepository.mockResolvedValue(undefined)
      const { result, refreshGitStatus, refreshHistory } = setup(notRepo)
      ;(which === 'status' ? refreshGitStatus : refreshHistory).mockRejectedValueOnce(
        new Error('取り直しに失敗')
      )
      let succeeded = false
      await act(async () => {
        succeeded = await result.current.initRepository('main')
      })
      expect(succeeded).toBe(true)
      expect(result.current.initError).toBeNull()
      expect(result.current.isInitializing).toBe(false)
    }
  )

  it('実行中の二重呼び出しは 1 回だけ実行し、2 回目は false', async () => {
    const pending = hold(mockInitRepository)
    const { result } = setup(notRepo)
    let first: Promise<boolean> = Promise.resolve(false)
    let second = true
    act(() => {
      first = result.current.initRepository('main')
    })
    await act(async () => {
      second = await result.current.initRepository('main')
    })
    expect(second).toBe(false)
    await act(async () => {
      pending.resolve()
      await first
    })
    expect(mockInitRepository).toHaveBeenCalledOnce()
  })

  it('他の Git 操作がロック中なら実行せず false を返し、表示中のエラーは消さない', async () => {
    mockInitRepository.mockRejectedValueOnce(new Error('前回の失敗'))
    let locked = false
    const lock = makeFileLock({ isAnyLocked: vi.fn(() => locked) })
    const { result } = setup(notRepo, lock)
    await act(async () => {
      await result.current.initRepository('a..b')
    })
    locked = true
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.initRepository('main')
    })
    expect(succeeded).toBe(false)
    expect(mockInitRepository).toHaveBeenCalledOnce()
    expect(result.current.initError?.message).toBe('前回の失敗')
  })

  // 再試行の実行中に前回の alert が残ると、実行中の案内と重なり、同じ文言の失敗が読み上げられない(パターン 87)
  it('再試行の開始時に前回のエラーを消す', async () => {
    mockInitRepository.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = setup(notRepo)
    await act(async () => {
      await result.current.initRepository('a..b')
    })
    const pending = hold(mockInitRepository)
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.initRepository('main')
    })
    expect(result.current.isInitializing).toBe(true)
    expect(result.current.initError).toBeNull()
    await act(async () => {
      pending.resolve()
      await promise
    })
  })

  it('clearInitError でエラーを消す', async () => {
    mockInitRepository.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = setup(notRepo)
    await act(async () => {
      await result.current.initRepository('a..b')
    })
    act(() => result.current.clearInitError())
    expect(result.current.initError).toBeNull()
  })
})

describe('addOrigin', () => {
  it('gitApi.addOrigin を呼び、ステータスだけを取り直して true を返す', async () => {
    mockAddOrigin.mockResolvedValue(undefined)
    const { result, refreshGitStatus, refreshHistory } = setup(repoWithoutOrigin)
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(succeeded).toBe(true)
    expect(mockAddOrigin).toHaveBeenCalledWith('https://github.com/a/b.git')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).not.toHaveBeenCalled()
    expect(result.current.isAddingOrigin).toBe(false)
  })

  // 実行中フラグは取り直しの後で下ろす(パターン 73)
  it('ステータスの取り直しが終わるまで isAddingOrigin は true のまま', async () => {
    mockAddOrigin.mockResolvedValue(undefined)
    const { result, refreshGitStatus } = setup(repoWithoutOrigin)
    let resolveStatus: () => void = () => {}
    refreshGitStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStatus = resolve
        })
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.addOrigin('https://github.com/a/b.git')
    })
    await waitFor(() => expect(refreshGitStatus).toHaveBeenCalled())
    expect(result.current.isAddingOrigin).toBe(true)
    let second = true
    await act(async () => {
      second = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(second).toBe(false)
    expect(mockAddOrigin).toHaveBeenCalledOnce()
    await act(async () => {
      resolveStatus()
      await promise
    })
    expect(result.current.isAddingOrigin).toBe(false)
  })

  // 取り直しの失敗で、成功した追加を失敗にしない(パターン 52)
  it('ステータスの取り直しが失敗しても、成功として true を返しエラーを出さない', async () => {
    mockAddOrigin.mockResolvedValue(undefined)
    const { result, refreshGitStatus } = setup(repoWithoutOrigin)
    refreshGitStatus.mockRejectedValueOnce(new Error('取り直しに失敗'))
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(succeeded).toBe(true)
    expect(result.current.addOriginError).toBeNull()
    expect(result.current.isAddingOrigin).toBe(false)
  })

  it('失敗は addOriginError に入れて false を返す', async () => {
    mockAddOrigin.mockRejectedValue(new Error('リモート origin は既に設定されています'))
    const { result } = setup(repoWithoutOrigin)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(succeeded).toBe(false)
    expect(result.current.addOriginError?.message).toBe('リモート origin は既に設定されています')
  })

  it('実行中は isAddingOrigin が true で、再試行の開始時に前回のエラーを消す', async () => {
    mockAddOrigin.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = setup(repoWithoutOrigin)
    await act(async () => {
      await result.current.addOrigin('x')
    })
    const pending = hold(mockAddOrigin)
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(result.current.isAddingOrigin).toBe(true)
    expect(result.current.addOriginError).toBeNull()
    await act(async () => {
      pending.resolve()
      await promise
    })
    expect(result.current.isAddingOrigin).toBe(false)
  })

  it.each([
    ['gitStatus が null', null, false],
    ['リポジトリでない', notRepo, false],
    ['ロック中', repoWithoutOrigin, true]
  ] as Array<[string, GitStatusResult | null, boolean]>)(
    '%s なら実行せず false を返す',
    async (_label, status, locked) => {
      const { result } = setup(status, makeFileLock({ isAnyLocked: vi.fn(() => locked) }))
      let succeeded = true
      await act(async () => {
        succeeded = await result.current.addOrigin('https://github.com/a/b.git')
      })
      expect(succeeded).toBe(false)
      expect(mockAddOrigin).not.toHaveBeenCalled()
    }
  )

  it('実行中の二重呼び出しは 1 回だけ実行し、2 回目は false', async () => {
    const pending = hold(mockAddOrigin)
    const { result } = setup(repoWithoutOrigin)
    let first: Promise<boolean> = Promise.resolve(false)
    let second = true
    act(() => {
      first = result.current.addOrigin('https://github.com/a/b.git')
    })
    await act(async () => {
      second = await result.current.addOrigin('https://github.com/a/b.git')
    })
    expect(second).toBe(false)
    await act(async () => {
      pending.resolve()
      await first
    })
    expect(mockAddOrigin).toHaveBeenCalledOnce()
  })

  it('clearAddOriginError でエラーを消す', async () => {
    mockAddOrigin.mockRejectedValueOnce(new Error('前回の失敗'))
    const { result } = setup(repoWithoutOrigin)
    await act(async () => {
      await result.current.addOrigin('x')
    })
    act(() => result.current.clearAddOriginError())
    expect(result.current.addOriginError).toBeNull()
  })
})
