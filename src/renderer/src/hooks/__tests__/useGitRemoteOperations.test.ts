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
    mockPull.mockResolvedValue(undefined)
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
    mockPull.mockResolvedValue(undefined)
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
        new Promise<void>((resolve) => {
          resolvePull = resolve
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
        new Promise<void>((resolve) => {
          resolvePull = resolve
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
    mockPull.mockResolvedValue(undefined)
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
    mockPull.mockResolvedValue(undefined)
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
        new Promise<void>((resolve) => {
          resolvePull = resolve
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
        new Promise<void>((resolve) => {
          resolvePull = resolve
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
        new Promise<void>((resolve) => {
          resolvePull = resolve
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
    mockPull.mockResolvedValue(undefined)
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
    mockPull.mockResolvedValue(undefined)
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
        new Promise<void>((resolve) => {
          resolvePull = resolve
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
