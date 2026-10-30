import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitRemoteOperations } from '../useGitRemoteOperations'
import type { FileOperationLock } from '../useFileOperationLock'

const mockPush = vi.mocked(gitApi.push)
const mockPull = vi.mocked(gitApi.pull)
const mockFetchRemote = vi.mocked(gitApi.fetchRemote)
const mockPushSetUpstream = vi.mocked(gitApi.pushSetUpstream)

// useGitOperations.test.ts と同じパターン。デフォルト値(何もロックされていない
// 状態)に overrides をマージして返す
const makeFileLock = (overrides: Partial<FileOperationLock> = {}): FileOperationLock => ({
  isLocked: vi.fn().mockReturnValue(false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn().mockReturnValue(false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn(),
  ...overrides
})

// ほとんどのテストは「push/pull/fetch が実行可能なリポジトリ」を前提にする。
// isRepo/gitStatus 自体の判定は別の describe ブロックでのみ検証する
const pullSucceeded = { conflicted: false }

const repoStatus: GitStatusResult = {
  isRepo: true,
  mergeInProgress: false,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}

beforeEach(() => {
  vi.clearAllMocks()
  // clearAllMocks は呼び出し履歴だけを消し、mockResolvedValue などの実装は残す。前のテストの実装が
  // 後のテストへ漏れないよう、実装ごとリセットする(pushSetUpstream は専用の describe でリセットする)
  mockPush.mockReset()
  mockPull.mockReset()
  mockFetchRemote.mockReset()
})

describe('fetchRemote', () => {
  it('gitApi.fetchRemote を呼び、完了後に refreshGitStatus を呼ぶ', async () => {
    mockFetchRemote.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    await act(async () => {
      await result.current.fetchRemote()
    })

    expect(mockFetchRemote).toHaveBeenCalledOnce()
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  it('実行中は isFetching が true、完了後 false に戻る', async () => {
    let resolveFetch: () => void = () => {}
    mockFetchRemote.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    let fetchPromise: Promise<void> = Promise.resolve()
    act(() => {
      fetchPromise = result.current.fetchRemote()
    })
    expect(result.current.isFetching).toBe(true)

    await act(async () => {
      resolveFetch()
      await fetchPromise
    })
    expect(result.current.isFetching).toBe(false)
  })

  it('実行中の多重呼び出しは gitApi.fetchRemote を1回しか呼ばない', async () => {
    let resolveFetch: () => void = () => {}
    mockFetchRemote.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.fetchRemote()
      second = result.current.fetchRemote()
    })

    await act(async () => {
      resolveFetch()
      await Promise.all([first, second])
    })
    expect(mockFetchRemote).toHaveBeenCalledTimes(1)
  })

  it('失敗時 remoteOperationError にセットされ、isFetching は false に戻る', async () => {
    mockFetchRemote.mockRejectedValue(new Error('fetch failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    await act(async () => {
      await result.current.fetchRemote()
    })

    expect(result.current.remoteOperationError?.message).toBe('fetch failed')
    expect(result.current.isFetching).toBe(false)
  })

  it('fetch 自体は成功しても refreshGitStatus が失敗した場合、remoteOperationError は null のまま', async () => {
    mockFetchRemote.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('refresh failed'))
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    await act(async () => {
      await result.current.fetchRemote()
    })

    expect(result.current.remoteOperationError).toBeNull()
    expect(result.current.isFetching).toBe(false)
  })

  it('fetch 実行中でも pull は実行できる(排他対象外)', async () => {
    let resolveFetch: () => void = () => {}
    mockFetchRemote.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve
        })
    )
    mockPull.mockResolvedValue(pullSucceeded)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus, lock))

    act(() => {
      void result.current.fetchRemote()
    })
    expect(result.current.isFetching).toBe(true)

    await act(async () => {
      await result.current.pull()
    })
    expect(mockPull).toHaveBeenCalledOnce()

    await act(async () => {
      resolveFetch()
    })
  })

  it('fetch は lock.lockGlobal/unlockGlobal を一切呼ばない', async () => {
    mockFetchRemote.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus, lock))

    await act(async () => {
      await result.current.fetchRemote()
    })

    expect(lock.lockGlobal).not.toHaveBeenCalled()
    expect(lock.unlockGlobal).not.toHaveBeenCalled()
  })
})

describe('pull', () => {
  it('gitApi.pull を呼び、実行中は lock.lockGlobal/unlockGlobal を呼ぶ', async () => {
    mockPull.mockResolvedValue(pullSucceeded)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus, lock))

    await act(async () => {
      await result.current.pull()
    })

    expect(mockPull).toHaveBeenCalledOnce()
    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  // fetchRemote の「実行中の多重呼び出しは1回しか呼ばない」と同じ観点。
  // isBusy() は同期的に ref を見るため、fetchRemote と同じ useRunRemoteOperation
  // を経由する pull/push でも同様に保証されるはずだが、fetchRemote にしか
  // 専用テストが無いとカバレッジが非対称になり、将来 push/pull だけ別実装に
  // リファクタされた場合の回帰を検知できない
  it('実行中の多重呼び出しは gitApi.pull を1回しか呼ばない', async () => {
    let resolvePull: () => void = () => {}
    mockPull.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve(pullSucceeded)
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    // isAnyLocked が常に false を返すモックロックを明示的に渡す。既定の
    // useFileOperationLock() のままだと、1回目の呼び出しで lock.lockGlobal() が
    // 実際に globallyLockedRef を立てて isAnyLocked() を true にするため、
    // isPullingRef.current のチェック自体が機能しなくても isAnyLocked() 経由で
    // たまたま2回目がブロックされてしまい、このテストが検証したい「自分自身の
    // 多重発火防止」を検知できなくなる(レビュー指摘で発覚)
    const lock = makeFileLock()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus, lock))

    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.pull()
      second = result.current.pull()
    })

    await act(async () => {
      resolvePull()
      await Promise.all([first, second])
    })
    expect(mockPull).toHaveBeenCalledTimes(1)
  })

  it('実行中は isPulling が true、完了後 false に戻る', async () => {
    let resolvePull: () => void = () => {}
    mockPull.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve(pullSucceeded)
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    let pullPromise: Promise<void> = Promise.resolve()
    act(() => {
      pullPromise = result.current.pull()
    })
    expect(result.current.isPulling).toBe(true)

    await act(async () => {
      resolvePull()
      await pullPromise
    })
    expect(result.current.isPulling).toBe(false)
  })

  it('lock.isAnyLocked() が true(ハンク操作中 or commit 中)のときは no-op', async () => {
    mockPull.mockResolvedValue(pullSucceeded)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus, lock))

    await act(async () => {
      await result.current.pull()
    })

    expect(mockPull).not.toHaveBeenCalled()
    expect(lock.lockGlobal).not.toHaveBeenCalled()
  })

  it('push 実行中は no-op', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        })
    )
    mockPull.mockResolvedValue(pullSucceeded)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    act(() => {
      void result.current.push()
    })
    expect(result.current.isPushing).toBe(true)

    await act(async () => {
      await result.current.pull()
    })
    expect(mockPull).not.toHaveBeenCalled()

    await act(async () => {
      resolvePush()
    })
  })

  it('失敗時 remoteOperationError にセットされ、ロックは必ず解除される', async () => {
    mockPull.mockRejectedValue(new Error('pull failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus, lock))

    await act(async () => {
      await result.current.pull()
    })

    expect(result.current.remoteOperationError?.message).toBe('pull failed')
    expect(result.current.isPulling).toBe(false)
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('pull 自体は失敗しても refreshGitStatus の失敗理由で remoteOperationError が上書きされない', async () => {
    mockPull.mockRejectedValue(new Error('pull failed'))
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('refresh failed'))
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    await act(async () => {
      await result.current.pull()
    })

    expect(result.current.remoteOperationError?.message).toBe('pull failed')
  })

  it('pull 実行中でも fetch は実行できる(排他対象外)', async () => {
    let resolvePull: () => void = () => {}
    mockPull.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve(pullSucceeded)
        })
    )
    mockFetchRemote.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    act(() => {
      void result.current.pull()
    })
    expect(result.current.isPulling).toBe(true)

    await act(async () => {
      await result.current.fetchRemote()
    })
    expect(mockFetchRemote).toHaveBeenCalledOnce()

    await act(async () => {
      resolvePull()
    })
  })
})

describe('push', () => {
  it('gitApi.push を呼び、完了後に refreshGitStatus を呼ぶ', async () => {
    mockPush.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    await act(async () => {
      await result.current.push()
    })

    expect(mockPush).toHaveBeenCalledOnce()
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  // fetchRemote/pull の「実行中の多重呼び出しは1回しか呼ばない」と同じ観点。
  // カバレッジの非対称性を無くす
  it('実行中の多重呼び出しは gitApi.push を1回しか呼ばない', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.push()
      second = result.current.push()
    })

    await act(async () => {
      resolvePush()
      await Promise.all([first, second])
    })
    expect(mockPush).toHaveBeenCalledTimes(1)
  })

  it('実行中は isPushing が true、完了後 false に戻る', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    let pushPromise: Promise<void> = Promise.resolve()
    act(() => {
      pushPromise = result.current.push()
    })
    expect(result.current.isPushing).toBe(true)

    await act(async () => {
      resolvePush()
      await pushPromise
    })
    expect(result.current.isPushing).toBe(false)
  })

  it('pull 実行中は no-op', async () => {
    let resolvePull: () => void = () => {}
    mockPull.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve(pullSucceeded)
        })
    )
    mockPush.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    act(() => {
      void result.current.pull()
    })
    expect(result.current.isPulling).toBe(true)

    await act(async () => {
      await result.current.push()
    })
    expect(mockPush).not.toHaveBeenCalled()

    await act(async () => {
      resolvePull()
    })
  })

  // 「コミットしてすぐプッシュ」は一般的な操作パターン。commit/amend は
  // useGitOperations.ts の runCommitOperation が lock.lockGlobal() で実行中を
  // 示す(lock.isAnyLocked() が true になる)。これを push が見ていないと、
  // amend が HEAD を書き換えている最中に push が古い HEAD を読んでしまい、
  // ローカルは書き換え後のコミットを指すのにリモートには書き換え前が届く、
  // という取り違えが起きる
  it('commit/amend 実行中(lock.isAnyLocked() が true)は no-op', async () => {
    mockPush.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus, lock))

    await act(async () => {
      await result.current.push()
    })

    expect(mockPush).not.toHaveBeenCalled()
  })

  it('fetch 実行中でも push は実行できる(排他対象外)', async () => {
    let resolveFetch: () => void = () => {}
    mockFetchRemote.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve
        })
    )
    mockPush.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    act(() => {
      void result.current.fetchRemote()
    })
    expect(result.current.isFetching).toBe(true)

    await act(async () => {
      await result.current.push()
    })
    expect(mockPush).toHaveBeenCalledOnce()

    await act(async () => {
      resolveFetch()
    })
  })

  it('失敗時 remoteOperationError にセットされる', async () => {
    mockPush.mockRejectedValue(new Error('push failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    await act(async () => {
      await result.current.push()
    })

    expect(result.current.remoteOperationError?.message).toBe('push failed')
    expect(result.current.isPushing).toBe(false)
  })

  it('push は lock.lockGlobal/unlockGlobal を一切呼ばない', async () => {
    mockPush.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus, lock))

    await act(async () => {
      await result.current.push()
    })

    expect(lock.lockGlobal).not.toHaveBeenCalled()
    expect(lock.unlockGlobal).not.toHaveBeenCalled()
  })
})

describe('isPushBlocked / isPullBlocked', () => {
  // 「push と pull は同時実行不可」「pull はハンク操作/commit 中も不可」という
  // 業務ルールは、実行を止める isBusy 判定(このフック内)にのみ存在させ、
  // UI(SourceControlToolbar)側は isPushBlocked/isPullBlocked をそのまま
  // disabled 判定に使うだけにする。UI 側に同じルールを再実装させないための値
  it('何も実行中でなければ両方 false', () => {
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    expect(result.current.isPushBlocked).toBe(false)
    expect(result.current.isPullBlocked).toBe(false)
  })

  it('pull 実行中は isPushBlocked が true になる', async () => {
    let resolvePull: () => void = () => {}
    mockPull.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve(pullSucceeded)
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    act(() => {
      void result.current.pull()
    })
    expect(result.current.isPushBlocked).toBe(true)

    await act(async () => {
      resolvePull()
    })
  })

  it('push 実行中は isPullBlocked が true になる', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    act(() => {
      void result.current.push()
    })
    expect(result.current.isPullBlocked).toBe(true)

    await act(async () => {
      resolvePush()
    })
  })

  it('lock.isAnyLocked() が true(ハンク操作中 or commit 中)のとき isPullBlocked と isPushBlocked がともに true になる', () => {
    // commit/amend 実行中に push すると、書き換え中の HEAD を読んでしまう
    // 可能性があるため(「コミットしてすぐプッシュ」レース対策)、push も妨げる
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus, lock))

    expect(result.current.isPullBlocked).toBe(true)
    expect(result.current.isPushBlocked).toBe(true)
  })

  it('fetch 実行中は isPushBlocked/isPullBlocked いずれも false のまま(排他対象外)', async () => {
    let resolveFetch: () => void = () => {}
    mockFetchRemote.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveFetch = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    act(() => {
      void result.current.fetchRemote()
    })
    expect(result.current.isPushBlocked).toBe(false)
    expect(result.current.isPullBlocked).toBe(false)

    await act(async () => {
      resolveFetch()
    })
  })
})

describe('isRemoteOperationDisabled', () => {
  // 「リポジトリが無ければ push/pull/fetch は実行不可」という業務ルールも、
  // push/pull 排他ルールと同じ理由でこのフックに一元化する。UI(SourceControlToolbar)
  // 側は gitStatus 自体を知らなくてよく、この値をそのまま disabled に使うだけにする
  it('isRepo な gitStatus なら false', () => {
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    expect(result.current.isRemoteOperationDisabled).toBe(false)
  })

  it('gitStatus が null なら true', () => {
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(null, refreshGitStatus))

    expect(result.current.isRemoteOperationDisabled).toBe(true)
  })

  it('isRepo: false なら true', () => {
    const notRepo: GitStatusResult = {
      isRepo: false,
      mergeInProgress: false,
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: []
    }
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(notRepo, refreshGitStatus))

    expect(result.current.isRemoteOperationDisabled).toBe(true)
  })

  it('gitStatus が null のとき push/pull/fetch は実行されない(no-op)', async () => {
    mockPush.mockResolvedValue(undefined)
    mockPull.mockResolvedValue(pullSucceeded)
    mockFetchRemote.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(null, refreshGitStatus))

    await act(async () => {
      await result.current.push()
    })
    await act(async () => {
      await result.current.pull()
    })
    await act(async () => {
      await result.current.fetchRemote()
    })

    expect(mockPush).not.toHaveBeenCalled()
    expect(mockPull).not.toHaveBeenCalled()
    expect(mockFetchRemote).not.toHaveBeenCalled()
  })

  it('isRepo: false のとき push/pull/fetch は実行されない(no-op)', async () => {
    const notRepo: GitStatusResult = {
      isRepo: false,
      mergeInProgress: false,
      hasOrigin: false,
      hasRemote: false,
      upstream: null,
      detached: false,
      branch: null,
      ahead: 0,
      behind: 0,
      files: []
    }
    mockPush.mockResolvedValue(undefined)
    mockPull.mockResolvedValue(pullSucceeded)
    mockFetchRemote.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(notRepo, refreshGitStatus))

    await act(async () => {
      await result.current.push()
    })
    await act(async () => {
      await result.current.pull()
    })
    await act(async () => {
      await result.current.fetchRemote()
    })

    expect(mockPush).not.toHaveBeenCalled()
    expect(mockPull).not.toHaveBeenCalled()
    expect(mockFetchRemote).not.toHaveBeenCalled()
  })
})

describe('pushSetUpstream(初回 push)', () => {
  const makeRefreshes = (): {
    refreshGitStatus: ReturnType<typeof vi.fn<() => Promise<void>>>
    refreshHistory: ReturnType<typeof vi.fn<() => Promise<void>>>
  } => ({
    refreshGitStatus: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    refreshHistory: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  })

  // 保留させ、解決・失敗を後から起こせるようにする
  const holdSetUpstream = (): { resolve: () => void; reject: (err: Error) => void } => {
    const handlers: { resolve: () => void; reject: (err: Error) => void } = {
      resolve: () => {},
      reject: () => {}
    }
    mockPushSetUpstream.mockImplementationOnce(
      () =>
        new Promise<void>((resolve, reject) => {
          handlers.resolve = () => resolve()
          handlers.reject = reject
        })
    )
    return { resolve: () => handlers.resolve(), reject: (err) => handlers.reject(err) }
  }

  beforeEach(() => {
    mockPushSetUpstream.mockReset()
  })

  it('gitApi.pushSetUpstream を呼び、ステータスと履歴を取り直して true を返す', async () => {
    mockPushSetUpstream.mockResolvedValue(undefined)
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.pushSetUpstream()
    })
    expect(succeeded).toBe(true)
    expect(mockPushSetUpstream).toHaveBeenCalledOnce()
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
    expect(result.current.isSettingUpstream).toBe(false)
    expect(result.current.isPushing).toBe(false)
    expect(result.current.remoteOperationError).toBeNull()
  })

  // 既存の呼び出し(refreshHistory を渡さない)は従来どおり動く(差分 3)
  it('refreshHistory を渡さなければ、ステータスだけ取り直す', async () => {
    mockPushSetUpstream.mockResolvedValue(undefined)
    const { refreshGitStatus } = makeRefreshes()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))
    await act(async () => {
      await result.current.pushSetUpstream()
    })
    expect(refreshGitStatus).toHaveBeenCalledOnce()
  })

  // push と初回 push は同じ ref と branch.<b> の設定を書くため、同時に走らせない
  it('実行中は isSettingUpstream と isPushing が true で、ツールバーの push は実行されない', async () => {
    const pending = holdSetUpstream()
    mockPush.mockResolvedValue(undefined)
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.pushSetUpstream()
    })
    expect(result.current.isSettingUpstream).toBe(true)
    expect(result.current.isPushing).toBe(true)
    await act(async () => {
      await result.current.push()
    })
    expect(mockPush).not.toHaveBeenCalled()
    await act(async () => {
      pending.resolve()
      await promise
    })
    expect(result.current.isSettingUpstream).toBe(false)
    expect(result.current.isPushing).toBe(false)
  })

  it('ツールバーの push の実行中は実行せず false を返し、isSettingUpstream は立たない', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        })
    )
    const { refreshGitStatus } = makeRefreshes()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))
    let pushPromise: Promise<void> = Promise.resolve()
    act(() => {
      pushPromise = result.current.push()
    })
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.pushSetUpstream()
    })
    expect(succeeded).toBe(false)
    expect(mockPushSetUpstream).not.toHaveBeenCalled()
    expect(result.current.isSettingUpstream).toBe(false)
    await act(async () => {
      resolvePush()
      await pushPromise
    })
  })

  // 実行中フラグは取り直しの後で下ろす(パターン 73)
  it('取り直しが終わるまで isSettingUpstream は true のまま', async () => {
    mockPushSetUpstream.mockResolvedValue(undefined)
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    let resolveRefresh: () => void = () => {}
    refreshHistory.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
    )
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.pushSetUpstream()
    })
    await waitFor(() => expect(refreshHistory).toHaveBeenCalled())
    expect(result.current.isSettingUpstream).toBe(true)
    await act(async () => {
      resolveRefresh()
      await promise
    })
    expect(result.current.isSettingUpstream).toBe(false)
  })

  // 履歴の取り直しが先に失敗しても、ステータスの取り直しを待ってから実行中フラグを下ろす。Promise.all では
  // 先に失敗した時点で下ろしてしまい、upstream 未設定の古い表示のまま初回 push を押せる(パターン 73)
  it('履歴の取り直しが即失敗しても、ステータスの取り直しが終わるまで isSettingUpstream は true のまま', async () => {
    mockPushSetUpstream.mockResolvedValue(undefined)
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    let resolveStatus: () => void = () => {}
    refreshGitStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveStatus = resolve
        })
    )
    refreshHistory.mockRejectedValueOnce(new Error('履歴の取得に失敗'))
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.pushSetUpstream()
    })
    await waitFor(() => expect(refreshHistory).toHaveBeenCalled())
    // 履歴の失敗が処理されるまで待つ(Promise.all なら、ここで実行中フラグが下りる)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(result.current.isSettingUpstream).toBe(true)
    expect(result.current.isPushing).toBe(true)
    let second = true
    await act(async () => {
      second = await result.current.pushSetUpstream()
    })
    expect(second).toBe(false)
    expect(mockPushSetUpstream).toHaveBeenCalledOnce()
    let succeeded = false
    await act(async () => {
      resolveStatus()
      succeeded = await promise
    })
    expect(succeeded).toBe(true)
    expect(result.current.isSettingUpstream).toBe(false)
  })

  // 取り直しの失敗で、成功した初回 push を失敗にしない(パターン 52)
  it.each([
    ['ステータス', 'status'],
    ['履歴', 'history']
  ] as const)(
    '%sの取り直しが失敗しても、成功として true を返しエラーを出さない',
    async (_label, which) => {
      mockPushSetUpstream.mockResolvedValue(undefined)
      const { refreshGitStatus, refreshHistory } = makeRefreshes()
      ;(which === 'status' ? refreshGitStatus : refreshHistory).mockRejectedValueOnce(
        new Error('取り直しに失敗')
      )
      const { result } = renderHook(() =>
        useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
      )
      let succeeded = false
      await act(async () => {
        succeeded = await result.current.pushSetUpstream()
      })
      expect(succeeded).toBe(true)
      expect(result.current.remoteOperationError).toBeNull()
      expect(result.current.isSettingUpstream).toBe(false)
    }
  )

  it('失敗は remoteOperationError に入れて false を返し、取り直しはする', async () => {
    mockPushSetUpstream.mockRejectedValue(
      new Error('コミットが無いため、初回 push できません。先にコミットしてください')
    )
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.pushSetUpstream()
    })
    expect(succeeded).toBe(false)
    expect(result.current.remoteOperationError?.message).toBe(
      'コミットが無いため、初回 push できません。先にコミットしてください'
    )
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // パネル上部の前回のエラーが、再試行の実行中に残らない(パターン 87)
  it('再試行の開始時に前回のエラーを消す', async () => {
    mockPushSetUpstream.mockRejectedValueOnce(new Error('前回の失敗'))
    const { refreshGitStatus } = makeRefreshes()
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))
    await act(async () => {
      await result.current.pushSetUpstream()
    })
    expect(result.current.remoteOperationError?.message).toBe('前回の失敗')
    const pending = holdSetUpstream()
    let promise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      promise = result.current.pushSetUpstream()
    })
    expect(result.current.remoteOperationError).toBeNull()
    await act(async () => {
      pending.resolve()
      await promise
    })
  })

  it.each([
    ['リポジトリが無い(null)', null, false],
    ['ロック中', repoStatus, true]
  ] as Array<[string, GitStatusResult | null, boolean]>)(
    '%s なら実行せず false を返す',
    async (_label, status, locked) => {
      const { refreshGitStatus } = makeRefreshes()
      const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(locked) })
      const { result } = renderHook(() => useGitRemoteOperations(status, refreshGitStatus, lock))
      let succeeded = true
      await act(async () => {
        succeeded = await result.current.pushSetUpstream()
      })
      expect(succeeded).toBe(false)
      expect(mockPushSetUpstream).not.toHaveBeenCalled()
    }
  )

  // pull の lockGlobal(全体ロック)とは別に、pull の実行中フラグでも止めることを確かめるため、
  // lockGlobal が何もしないロックを渡す
  it('pull の実行中は実行せず false を返す', async () => {
    let resolvePull: () => void = () => {}
    mockPull.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve(pullSucceeded)
        })
    )
    const { refreshGitStatus } = makeRefreshes()
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, makeFileLock())
    )
    let pullPromise: Promise<void> = Promise.resolve()
    act(() => {
      pullPromise = result.current.pull()
    })
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.pushSetUpstream()
    })
    expect(succeeded).toBe(false)
    expect(mockPushSetUpstream).not.toHaveBeenCalled()
    await act(async () => {
      resolvePull()
      await pullPromise
    })
  })
})

// fetch・pull・push の後は履歴も取り直す(上流のコミットと origin/main のラベルが変わるため)
describe('fetch・pull・push の後の履歴の取り直し', () => {
  type Operation = 'fetchRemote' | 'pull' | 'push'
  const operations: Array<{
    name: Operation
    mockSuccess: () => void
    mockFailure: (error: Error) => void
    busyFlag: 'isFetching' | 'isPulling' | 'isPushing'
  }> = [
    {
      name: 'fetchRemote',
      mockSuccess: () => mockFetchRemote.mockResolvedValue(undefined),
      mockFailure: (error) => mockFetchRemote.mockRejectedValue(error),
      busyFlag: 'isFetching'
    },
    {
      name: 'pull',
      mockSuccess: () => mockPull.mockResolvedValue(pullSucceeded),
      mockFailure: (error) => mockPull.mockRejectedValue(error),
      busyFlag: 'isPulling'
    },
    {
      name: 'push',
      mockSuccess: () => mockPush.mockResolvedValue(undefined),
      mockFailure: (error) => mockPush.mockRejectedValue(error),
      busyFlag: 'isPushing'
    }
  ]

  const makeRefreshes = (): {
    refreshGitStatus: ReturnType<typeof vi.fn<() => Promise<void>>>
    refreshHistory: ReturnType<typeof vi.fn<() => Promise<void>>>
  } => ({
    refreshGitStatus: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    refreshHistory: vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  })

  it.each(operations)('$name の成功の後に、ステータスと履歴を取り直す', async (operation) => {
    operation.mockSuccess()
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
    )

    await act(async () => {
      await result.current[operation.name]()
    })

    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  it.each(operations)(
    '$name が失敗してもステータスと履歴を取り直し、エラーの表示は保つ',
    async (operation) => {
      operation.mockFailure(new Error('操作に失敗'))
      const { refreshGitStatus, refreshHistory } = makeRefreshes()
      const { result } = renderHook(() =>
        useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
      )

      await act(async () => {
        await result.current[operation.name]()
      })

      expect(refreshGitStatus).toHaveBeenCalledOnce()
      expect(refreshHistory).toHaveBeenCalledOnce()
      expect(result.current.remoteOperationError?.message).toBe('操作に失敗')
      expect(result.current[operation.busyFlag]).toBe(false)
    }
  )

  it.each(operations)(
    '$name の履歴の取り直しが失敗しても、操作のエラーにはせず実行中フラグを下ろす',
    async (operation) => {
      operation.mockSuccess()
      const { refreshGitStatus, refreshHistory } = makeRefreshes()
      refreshHistory.mockRejectedValueOnce(new Error('履歴の取得に失敗'))
      const { result } = renderHook(() =>
        useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
      )

      await act(async () => {
        await result.current[operation.name]()
      })

      expect(result.current.remoteOperationError).toBeNull()
      expect(result.current[operation.busyFlag]).toBe(false)
    }
  )

  it.each(operations)(
    '$name は履歴が先に失敗しても、ステータスの取り直しが終わるまで実行中フラグを保つ',
    async (operation) => {
      operation.mockSuccess()
      const { refreshGitStatus, refreshHistory } = makeRefreshes()
      let resolveStatus: () => void = () => {}
      refreshGitStatus.mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            resolveStatus = resolve
          })
      )
      refreshHistory.mockRejectedValueOnce(new Error('履歴の取得に失敗'))
      const { result } = renderHook(() =>
        useGitRemoteOperations(repoStatus, refreshGitStatus, undefined, refreshHistory)
      )

      let operationPromise!: Promise<void>
      await act(async () => {
        operationPromise = result.current[operation.name]()
        await Promise.resolve()
      })
      await waitFor(() => expect(refreshHistory).toHaveBeenCalled())
      // Promise.all だと、履歴の失敗の時点で実行中フラグが下りる
      await act(async () => {
        await new Promise((resolve) => setImmediate(resolve))
      })
      expect(result.current[operation.busyFlag]).toBe(true)

      await act(async () => {
        resolveStatus()
        await operationPromise
      })
      expect(result.current[operation.busyFlag]).toBe(false)
    }
  )

  it('pull の共有ロックは、履歴の取り直しが終わるまで解放しない', async () => {
    mockPull.mockResolvedValue(pullSucceeded)
    const fileLock = makeFileLock()
    const { refreshGitStatus, refreshHistory } = makeRefreshes()
    let resolveHistory: () => void = () => {}
    refreshHistory.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveHistory = resolve
        })
    )
    const { result } = renderHook(() =>
      useGitRemoteOperations(repoStatus, refreshGitStatus, fileLock, refreshHistory)
    )

    let pullPromise!: Promise<void>
    await act(async () => {
      pullPromise = result.current.pull()
      await Promise.resolve()
    })
    await waitFor(() => expect(refreshHistory).toHaveBeenCalled())
    expect(fileLock.unlockGlobal).not.toHaveBeenCalled()

    await act(async () => {
      resolveHistory()
      await pullPromise
    })
    expect(fileLock.unlockGlobal).toHaveBeenCalledOnce()
  })
})

describe('pull の結果の表示', () => {
  it('コンフリクトでも、例外にならなかった pull はエラーを出さない', async () => {
    mockPull.mockResolvedValue({ conflicted: true })
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    await act(async () => {
      await result.current.pull()
    })

    expect(result.current.remoteOperationError).toBeNull()
  })

  it('例外だったコンフリクトは、これまでどおり git の文言を出す', async () => {
    mockPull.mockResolvedValue({ conflicted: true, errorMessage: 'CONFLICT (content)' })
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    await act(async () => {
      await result.current.pull()
    })

    expect(result.current.remoteOperationError?.message).toBe('CONFLICT (content)')
  })
})

describe('syncChanges', () => {
  const CONFLICT_MESSAGE = 'プルでコンフリクトが発生しました。解決してからもう一度同期してください'
  const refreshGitStatus = vi.fn<() => Promise<void>>()
  const statusWith = (overrides: Partial<GitStatusResult>): GitStatusResult => ({
    ...repoStatus,
    ...overrides
  })
  const syncedOnce = async (
    status: GitStatusResult,
    lock?: FileOperationLock
  ): Promise<ReturnType<typeof renderHook<ReturnType<typeof useGitRemoteOperations>, unknown>>> => {
    const hook = renderHook(() => useGitRemoteOperations(status, refreshGitStatus, lock))
    await act(async () => {
      await hook.result.current.syncChanges()
    })
    return hook
  }

  it('完了の後も失敗の後も、もう一度同期できる', async () => {
    const hook = await syncedOnce(statusWith({ behind: 1 }))
    expect(mockPull).toHaveBeenCalledTimes(1)
    mockPull.mockRejectedValueOnce(new Error('pull failed'))
    await act(async () => {
      await hook.result.current.syncChanges()
    })
    expect(mockPull).toHaveBeenCalledTimes(2)
    await act(async () => {
      await hook.result.current.syncChanges()
    })
    expect(mockPull).toHaveBeenCalledTimes(3)
  })

  beforeEach(() => {
    refreshGitStatus.mockReset()
    refreshGitStatus.mockResolvedValue(undefined)
    mockPull.mockResolvedValue(pullSucceeded)
    mockPush.mockResolvedValue(undefined)
  })

  it('behind だけならプルだけを実行する', async () => {
    await syncedOnce(statusWith({ behind: 2 }))
    expect(mockPull).toHaveBeenCalledOnce()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('ahead だけならプッシュだけを実行する', async () => {
    await syncedOnce(statusWith({ ahead: 2 }))
    expect(mockPull).not.toHaveBeenCalled()
    expect(mockPush).toHaveBeenCalledOnce()
  })

  it('両方あるならプル、プッシュの順に実行する', async () => {
    await syncedOnce(statusWith({ ahead: 1, behind: 1 }))
    expect(mockPull).toHaveBeenCalledOnce()
    expect(mockPush).toHaveBeenCalledOnce()
    expect(mockPull.mock.invocationCallOrder[0]).toBeLessThan(mockPush.mock.invocationCallOrder[0])
  })

  it('どちらも 0 なら何も実行しない', async () => {
    await syncedOnce(repoStatus)
    expect(mockPull).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('プルが失敗したらプッシュせず、エラーを出す', async () => {
    mockPull.mockRejectedValue(new Error('pull failed'))
    const { result } = await syncedOnce(statusWith({ ahead: 1, behind: 1 }))
    expect(mockPush).not.toHaveBeenCalled()
    expect(result.current.remoteOperationError?.message).toBe('pull failed')
    expect(result.current.isSyncing).toBe(false)
  })

  it.each([
    ['例外にならなかった', { conflicted: true }],
    ['例外だった', { conflicted: true, errorMessage: 'CONFLICT (content)' }]
  ])('%s コンフリクトではプッシュせず、案内を出す', async (_, pullResult) => {
    mockPull.mockResolvedValue(pullResult)
    const { result } = await syncedOnce(statusWith({ ahead: 1, behind: 1 }))
    expect(mockPush).not.toHaveBeenCalled()
    expect(result.current.remoteOperationError?.message).toBe(CONFLICT_MESSAGE)
  })

  // 例外の形のコンフリクトでも、取り直しの間に git の英語の文言を挟まない
  it('同期のコンフリクトは、取り直しの間も git の文言を出さない', async () => {
    mockPull.mockResolvedValue({ conflicted: true, errorMessage: 'CONFLICT (content)' })
    let resolveRefresh: () => void = () => {}
    refreshGitStatus.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveRefresh = resolve
        })
    )
    const status = statusWith({ behind: 1 })
    const { result } = renderHook(() => useGitRemoteOperations(status, refreshGitStatus))

    let syncing!: Promise<void>
    await act(async () => {
      syncing = result.current.syncChanges()
      await Promise.resolve()
    })
    await waitFor(() => expect(refreshGitStatus).toHaveBeenCalled())
    expect(result.current.remoteOperationError).toBeNull()

    await act(async () => {
      resolveRefresh()
      await syncing
    })
    expect(result.current.remoteOperationError?.message).toBe(CONFLICT_MESSAGE)
  })

  describe('コンフリクトの通知の消去', () => {
    const conflictedFile = { path: 'a.txt', index: 'U', workingDir: 'U' }
    const behindStatus = statusWith({ behind: 1 })
    const conflictedStatus = statusWith({ behind: 1, files: [conflictedFile] })
    const renderWithStatus = (): ReturnType<
      typeof renderHook<ReturnType<typeof useGitRemoteOperations>, { status: GitStatusResult }>
    > =>
      renderHook(({ status }) => useGitRemoteOperations(status, refreshGitStatus), {
        initialProps: { status: behindStatus }
      })

    beforeEach(() => {
      mockPull.mockResolvedValue({ conflicted: true })
    })

    it('未解決のファイルが無くなると消す(rebase は mergeInProgress が false のまま)', async () => {
      const { result, rerender } = renderWithStatus()
      await act(async () => {
        await result.current.syncChanges()
      })
      rerender({ status: conflictedStatus })
      expect(result.current.remoteOperationError?.message).toBe(CONFLICT_MESSAGE)

      rerender({ status: behindStatus })
      expect(result.current.remoteOperationError).toBeNull()
    })

    // 通知は取り直しの後に出す。取り直しで先に未解決のファイルが見えていても、解決で消せること
    it('通知より先に未解決のファイルが見えていても、無くなると消す', async () => {
      const { result, rerender } = renderWithStatus()
      refreshGitStatus.mockImplementationOnce(async () => {
        rerender({ status: conflictedStatus })
      })
      await act(async () => {
        await result.current.syncChanges()
      })
      expect(result.current.remoteOperationError?.message).toBe(CONFLICT_MESSAGE)

      rerender({ status: behindStatus })
      expect(result.current.remoteOperationError).toBeNull()
    })

    // 取り直しが失敗や競合で反映されないと、未解決のファイルは見えないまま。一度も見えていないなら消さない
    it('未解決のファイルが一度も見えていなければ消さない', async () => {
      const { result, rerender } = renderWithStatus()
      await act(async () => {
        await result.current.syncChanges()
      })
      rerender({ status: statusWith({ behind: 2 }) })
      expect(result.current.remoteOperationError?.message).toBe(CONFLICT_MESSAGE)
    })

    it('別のエラーに置き換わっていれば消さない', async () => {
      mockPush.mockRejectedValue(new Error('push failed'))
      const { result, rerender } = renderWithStatus()
      await act(async () => {
        await result.current.syncChanges()
      })
      rerender({ status: conflictedStatus })
      await act(async () => {
        await result.current.push()
      })

      rerender({ status: behindStatus })
      expect(result.current.remoteOperationError?.message).toBe('push failed')
    })
  })

  it('プルが未実行(別の操作の実行中)ならプッシュしない', async () => {
    // プルの判定のときだけロック中にする。プッシュの判定まで残ると、プッシュ側の判定で止まり区別できない
    const isAnyLocked = vi.fn().mockReturnValue(false)
    const lock = makeFileLock({ isAnyLocked })
    const hook = renderHook(() =>
      useGitRemoteOperations(statusWith({ ahead: 1, behind: 1 }), refreshGitStatus, lock)
    )
    isAnyLocked.mockReturnValueOnce(true)
    await act(async () => {
      await hook.result.current.syncChanges()
    })
    expect(mockPull).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('マージ中は実行しない', async () => {
    await syncedOnce(statusWith({ ahead: 1, behind: 1, mergeInProgress: true }))
    expect(mockPull).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('両方の完了まで isSyncing が true のままで、プッシュが失敗すればエラーを出す', async () => {
    let resolvePull: () => void = () => {}
    let rejectPush: (reason: Error) => void = () => {}
    mockPull.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve(pullSucceeded)
        })
    )
    mockPush.mockImplementation(
      () =>
        new Promise<void>((_, reject) => {
          rejectPush = reject
        })
    )
    const status = statusWith({ ahead: 1, behind: 1 })
    const { result } = renderHook(() => useGitRemoteOperations(status, refreshGitStatus))

    let syncing!: Promise<void>
    await act(async () => {
      syncing = result.current.syncChanges()
      await Promise.resolve()
    })
    expect(result.current.isSyncing).toBe(true)
    expect(result.current.isPulling).toBe(true)

    await act(async () => {
      resolvePull()
    })
    await waitFor(() => expect(mockPush).toHaveBeenCalledOnce())
    expect(result.current.isSyncing).toBe(true)
    expect(result.current.isPulling).toBe(false)

    await act(async () => {
      rejectPush(new Error('push failed'))
      await syncing
    })
    expect(result.current.isSyncing).toBe(false)
    expect(result.current.remoteOperationError?.message).toBe('push failed')
  })

  // プッシュ側の判定でも 2 回目は実行されないため、回数だけでは見分けられない。2 回目が先に終わって
  // 実行中の表示を下ろさないことまで確かめる
  it('実行中の多重呼び出しは何もせず、isSyncing を下ろさない', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        })
    )
    const { result } = renderHook(() =>
      useGitRemoteOperations(statusWith({ ahead: 1 }), refreshGitStatus)
    )

    let syncing!: Promise<void>
    await act(async () => {
      syncing = result.current.syncChanges()
      await Promise.resolve()
    })
    await act(async () => {
      await result.current.syncChanges()
    })
    expect(result.current.isSyncing).toBe(true)
    expect(mockPush).toHaveBeenCalledOnce()

    await act(async () => {
      resolvePush()
      await syncing
    })
    expect(result.current.isSyncing).toBe(false)
  })

  it('プルの間に ahead が変わっても、開始時の値でプッシュを決める', async () => {
    let resolvePull: () => void = () => {}
    mockPull.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve(pullSucceeded)
        })
    )
    const { result, rerender } = renderHook(
      ({ status }) => useGitRemoteOperations(status, refreshGitStatus),
      { initialProps: { status: statusWith({ ahead: 1, behind: 1 }) } }
    )

    let syncing!: Promise<void>
    await act(async () => {
      syncing = result.current.syncChanges()
      await Promise.resolve()
    })
    rerender({ status: statusWith({ ahead: 0, behind: 1 }) })
    await act(async () => {
      resolvePull()
      await syncing
    })

    expect(mockPush).toHaveBeenCalledOnce()
  })

  describe('プルの間のフォルダの切り替え', () => {
    const status = statusWith({ ahead: 1, behind: 1 })
    const renderInFolder = (): ReturnType<
      typeof renderHook<ReturnType<typeof useGitRemoteOperations>, { folderPath: string }>
    > =>
      renderHook(
        ({ folderPath }) =>
          useGitRemoteOperations(status, refreshGitStatus, undefined, undefined, folderPath),
        { initialProps: { folderPath: '/project-a' } }
      )

    it('切り替わったらプッシュしない', async () => {
      let resolvePull: () => void = () => {}
      mockPull.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePull = () => resolve(pullSucceeded)
          })
      )
      const { result, rerender } = renderInFolder()

      let syncing!: Promise<void>
      await act(async () => {
        syncing = result.current.syncChanges()
        await Promise.resolve()
      })
      rerender({ folderPath: '/project-b' })
      await act(async () => {
        resolvePull()
        await syncing
      })

      expect(mockPush).not.toHaveBeenCalled()
      expect(result.current.isSyncing).toBe(false)
    })

    it('切り替わらなければプッシュする', async () => {
      const { result, rerender } = renderInFolder()
      rerender({ folderPath: '/project-a' })
      await act(async () => {
        await result.current.syncChanges()
      })
      expect(mockPush).toHaveBeenCalledOnce()
    })

    // ステータスバーは常に見えるため、前のフォルダの結果を、切り替えの後に遅れて出さない(要件 13a)
    const switchFoldersDuring = async (
      start: (hook: ReturnType<typeof renderInFolder>) => Promise<unknown>,
      finish: () => void
    ): Promise<ReturnType<typeof renderInFolder>> => {
      const hook = renderInFolder()
      let running!: Promise<unknown>
      await act(async () => {
        running = start(hook)
        await Promise.resolve()
      })
      hook.rerender({ folderPath: '/project-b' })
      await act(async () => {
        finish()
        await running
      })
      return hook
    }

    it('同期のプルの失敗を出さない', async () => {
      let rejectPull: (reason: Error) => void = () => {}
      mockPull.mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectPull = reject
          })
      )
      const { result } = await switchFoldersDuring(
        ({ result }) => result.current.syncChanges(),
        () => rejectPull(new Error('pull failed'))
      )
      expect(result.current.remoteOperationError).toBeNull()
    })

    it('同期のコンフリクトの通知を出さない', async () => {
      let resolvePull: () => void = () => {}
      mockPull.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolvePull = () => resolve({ conflicted: true })
          })
      )
      const { result } = await switchFoldersDuring(
        ({ result }) => result.current.syncChanges(),
        () => resolvePull()
      )
      expect(result.current.remoteOperationError).toBeNull()
    })

    it('公開の pull の失敗を出さない', async () => {
      let rejectPull: (reason: Error) => void = () => {}
      mockPull.mockImplementation(
        () =>
          new Promise((_, reject) => {
            rejectPull = reject
          })
      )
      const { result } = await switchFoldersDuring(
        ({ result }) => result.current.pull(),
        () => rejectPull(new Error('pull failed'))
      )
      expect(result.current.remoteOperationError).toBeNull()
    })

    it('push の失敗を出さない', async () => {
      let rejectPush: (reason: Error) => void = () => {}
      mockPush.mockImplementation(
        () =>
          new Promise<void>((_, reject) => {
            rejectPush = reject
          })
      )
      const { result } = await switchFoldersDuring(
        ({ result }) => result.current.push(),
        () => rejectPush(new Error('push failed'))
      )
      expect(result.current.remoteOperationError).toBeNull()
    })

    it('fetch の失敗を出さない', async () => {
      let rejectFetch: (reason: Error) => void = () => {}
      mockFetchRemote.mockImplementation(
        () =>
          new Promise<void>((_, reject) => {
            rejectFetch = reject
          })
      )
      const { result } = await switchFoldersDuring(
        ({ result }) => result.current.fetchRemote(),
        () => rejectFetch(new Error('fetch failed'))
      )
      expect(result.current.remoteOperationError).toBeNull()
    })

    // 成功も同じ。新しいフォルダで出ている失敗を、前のフォルダの成功で消さない
    it('前のフォルダの操作の成功で、新しいフォルダの失敗を消さない', async () => {
      let resolveFetch: () => void = () => {}
      mockFetchRemote.mockImplementation(
        () =>
          new Promise<void>((resolve) => {
            resolveFetch = resolve
          })
      )
      mockPush.mockRejectedValue(new Error('push failed'))
      const hook = renderInFolder()
      let fetching!: Promise<void>
      await act(async () => {
        fetching = hook.result.current.fetchRemote()
        await Promise.resolve()
      })
      hook.rerender({ folderPath: '/project-b' })
      await act(async () => {
        await hook.result.current.push()
      })
      await act(async () => {
        resolveFetch()
        await fetching
      })
      expect(hook.result.current.remoteOperationError?.message).toBe('push failed')
    })
  })
})

describe('isSyncBlocked', () => {
  const refreshGitStatus = vi.fn().mockResolvedValue(undefined)

  it('何も実行していなければ false', () => {
    const status = { ...repoStatus, ahead: 1, behind: 1 }
    const { result } = renderHook(() => useGitRemoteOperations(status, refreshGitStatus))
    expect(result.current.isSyncBlocked).toBe(false)
  })

  it('リポジトリが無ければ true', () => {
    const { result } = renderHook(() => useGitRemoteOperations(null, refreshGitStatus))
    expect(result.current.isSyncBlocked).toBe(true)
  })

  it('マージ中は true', () => {
    const status = { ...repoStatus, ahead: 1, mergeInProgress: true }
    const { result } = renderHook(() => useGitRemoteOperations(status, refreshGitStatus))
    expect(result.current.isSyncBlocked).toBe(true)
  })

  it('ロック中は、ahead・behind のどちらかがあれば true、どちらも 0 なら false', () => {
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const render = (status: GitStatusResult): boolean =>
      renderHook(() => useGitRemoteOperations(status, refreshGitStatus, lock)).result.current
        .isSyncBlocked
    expect(render({ ...repoStatus, behind: 1 })).toBe(true)
    expect(render({ ...repoStatus, ahead: 1 })).toBe(true)
    expect(render(repoStatus)).toBe(false)
  })

  it('プルの実行中は true', async () => {
    let resolvePull: () => void = () => {}
    mockPull.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePull = () => resolve(pullSucceeded)
        })
    )
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    let pulling!: Promise<void>
    await act(async () => {
      pulling = result.current.pull()
      await Promise.resolve()
    })
    expect(result.current.isSyncBlocked).toBe(true)

    await act(async () => {
      resolvePull()
      await pulling
    })
    expect(result.current.isSyncBlocked).toBe(false)
  })

  it('プッシュの実行中は true', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        })
    )
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))

    let pushing!: Promise<void>
    await act(async () => {
      pushing = result.current.push()
      await Promise.resolve()
    })
    expect(result.current.isSyncBlocked).toBe(true)

    await act(async () => {
      resolvePush()
      await pushing
    })
  })
})

describe('clearRemoteOperationError', () => {
  it('remoteOperationError を消す', async () => {
    mockPush.mockRejectedValue(new Error('push failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() => useGitRemoteOperations(repoStatus, refreshGitStatus))
    await act(async () => {
      await result.current.push()
    })
    expect(result.current.remoteOperationError).not.toBeNull()

    act(() => {
      result.current.clearRemoteOperationError()
    })

    expect(result.current.remoteOperationError).toBeNull()
  })
})
