import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitBranchOperations } from '../useGitBranchOperations'
import { useGitRemoteOperations } from '../useGitRemoteOperations'
import { useFileOperationLock } from '../useFileOperationLock'
import type { FileOperationLock } from '../useFileOperationLock'

const mockCheckoutBranch = vi.mocked(gitApi.checkoutBranch)
const mockCreateBranch = vi.mocked(gitApi.createBranch)
const mockPush = vi.mocked(gitApi.push)

// useGitRemoteOperations.test.ts と同じパターン。デフォルト値(何もロックされて
// いない状態)に overrides をマージして返す
const makeFileLock = (overrides: Partial<FileOperationLock> = {}): FileOperationLock => ({
  isLocked: vi.fn().mockReturnValue(false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn().mockReturnValue(false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn(),
  ...overrides
})

const repoStatus: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('checkoutBranch', () => {
  it('gitApi.checkoutBranch を branchName で呼び、完了後に refreshGitStatus と refreshHistory を呼ぶ', async () => {
    mockCheckoutBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory)
    )

    await act(async () => {
      await result.current.checkoutBranch('feature/x')
    })

    expect(mockCheckoutBranch).toHaveBeenCalledWith('feature/x')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  it('refreshGitStatus と refreshHistory を Promise.all で並列実行する(片方が先に解決しても pendingBranchOperation は両方完了するまで checkout のまま)', async () => {
    mockCheckoutBranch.mockResolvedValue(undefined)
    let resolveGitStatus: () => void = () => {}
    const refreshGitStatus = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveGitStatus = resolve
        })
    )
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory)
    )

    let checkoutPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      checkoutPromise = result.current.checkoutBranch('feature/x')
    })

    // refreshHistory は即座に解決するが、refreshGitStatus がまだ pending のため
    // 両方揃うまで pendingBranchOperation は checkout のまま
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.pendingBranchOperation).toBe('checkout')

    await act(async () => {
      resolveGitStatus()
      await checkoutPromise
    })
    expect(result.current.pendingBranchOperation).toBeNull()
  })

  it('実行中は pendingBranchOperation が checkout、完了後 null に戻る', async () => {
    let resolveCheckout: () => void = () => {}
    mockCheckoutBranch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCheckout = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory)
    )

    let checkoutPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      checkoutPromise = result.current.checkoutBranch('feature/x')
    })
    expect(result.current.pendingBranchOperation).toBe('checkout')

    await act(async () => {
      resolveCheckout()
      await checkoutPromise
    })
    expect(result.current.pendingBranchOperation).toBeNull()
  })

  it('実行中の多重呼び出しは gitApi.checkoutBranch を1回しか呼ばない', async () => {
    let resolveCheckout: () => void = () => {}
    mockCheckoutBranch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCheckout = resolve
        })
    )
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    // isAnyLocked が常に false を返す固定モックを明示的に渡す。既定の
    // useFileOperationLock() のままだと lockGlobal() の副作用で偽陽性になる
    // (docs/review-findings-patterns.md パターン16)
    const lock = makeFileLock()
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, lock)
    )

    let first: Promise<boolean> = Promise.resolve(false)
    let second: Promise<boolean> = Promise.resolve(false)
    act(() => {
      first = result.current.checkoutBranch('feature/x')
      second = result.current.checkoutBranch('feature/y')
    })

    await act(async () => {
      resolveCheckout()
      await Promise.all([first, second])
    })
    expect(mockCheckoutBranch).toHaveBeenCalledTimes(1)
  })

  it('実行中は lock.lockGlobal/unlockGlobal を呼ぶ', async () => {
    mockCheckoutBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, lock)
    )

    await act(async () => {
      await result.current.checkoutBranch('feature/x')
    })

    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('lock.isAnyLocked() が true(ハンク操作中 or commit/pull 中)のときは no-op', async () => {
    mockCheckoutBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, lock)
    )

    await act(async () => {
      await result.current.checkoutBranch('feature/x')
    })

    expect(mockCheckoutBranch).not.toHaveBeenCalled()
    expect(lock.lockGlobal).not.toHaveBeenCalled()
  })

  it('失敗時 branchOperationError にセットされ、ロックは必ず解除される', async () => {
    mockCheckoutBranch.mockRejectedValue(new Error('checkout failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, lock)
    )

    await act(async () => {
      await result.current.checkoutBranch('feature/x')
    })

    expect(result.current.branchOperationError?.message).toBe('checkout failed')
    expect(result.current.pendingBranchOperation).toBeNull()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('checkout 自体は失敗しても refreshGitStatus/refreshHistory の失敗理由で branchOperationError が上書きされない', async () => {
    mockCheckoutBranch.mockRejectedValue(new Error('checkout failed'))
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('refresh failed'))
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory)
    )

    await act(async () => {
      await result.current.checkoutBranch('feature/x')
    })

    expect(result.current.branchOperationError?.message).toBe('checkout failed')
  })

  it('checkout 自体は成功しても refreshGitStatus か refreshHistory が失敗した場合、branchOperationError は null のまま', async () => {
    mockCheckoutBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockRejectedValue(new Error('refresh failed'))
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory)
    )

    await act(async () => {
      await result.current.checkoutBranch('feature/x')
    })

    expect(result.current.branchOperationError).toBeNull()
    expect(result.current.pendingBranchOperation).toBeNull()
  })

  it('gitStatus が null のとき checkoutBranch は実行されない(no-op)', async () => {
    mockCheckoutBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(null, refreshGitStatus, refreshHistory)
    )

    await act(async () => {
      await result.current.checkoutBranch('feature/x')
    })

    expect(mockCheckoutBranch).not.toHaveBeenCalled()
  })

  it('isRepo: false のとき checkoutBranch は実行されない(no-op)', async () => {
    const notRepo: GitStatusResult = { isRepo: false, branch: null, ahead: 0, behind: 0, files: [] }
    mockCheckoutBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(notRepo, refreshGitStatus, refreshHistory)
    )

    await act(async () => {
      await result.current.checkoutBranch('feature/x')
    })

    expect(mockCheckoutBranch).not.toHaveBeenCalled()
  })

  // コードレビュー指摘: useAppState.ts の checkoutBranch ラッパーは
  // fileSystem.reloadOpenFiles() を「実際に checkout が成功したか」を見ずに
  // 無条件で呼んでいた。checkout が git レベルで失敗した場合や isBusy による
  // no-op の場合でも、reloadOpenFiles が開いている全タブを(切り替わって
  // いない)ディスク内容で上書きし、無関係な未保存編集をサイレントに破棄して
  // しまう。呼び出し元が成功可否を判定できるよう、戻り値で伝える
  it('実際に checkout が実行され成功した場合、true を返す', async () => {
    mockCheckoutBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory)
    )

    let succeeded: boolean = false
    await act(async () => {
      succeeded = await result.current.checkoutBranch('feature/x')
    })

    expect(succeeded).toBe(true)
  })

  it('checkout が git レベルで失敗した場合、false を返す', async () => {
    mockCheckoutBranch.mockRejectedValue(new Error('checkout failed'))
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory)
    )

    let succeeded: boolean = true
    await act(async () => {
      succeeded = await result.current.checkoutBranch('feature/x')
    })

    expect(succeeded).toBe(false)
  })

  it('isBusy による no-op(isRepo: false)の場合、false を返す', async () => {
    const notRepo: GitStatusResult = { isRepo: false, branch: null, ahead: 0, behind: 0, files: [] }
    mockCheckoutBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(notRepo, refreshGitStatus, refreshHistory)
    )

    let succeeded: boolean = true
    await act(async () => {
      succeeded = await result.current.checkoutBranch('feature/x')
    })

    expect(succeeded).toBe(false)
  })
})

// useGitRemoteOperations との相互作用。本物の useFileOperationLock() を1つだけ
// 生成し両フックに共有させることで、「checkout が lockGlobal を呼ぶだけで
// push 側の既存の isBusy 判定(lock.isAnyLocked())が自動的に checkout 実行中を
// 検知する」という設計(push 側のコード変更は一切不要)を統合的に検証する
describe('useGitRemoteOperations との相互作用', () => {
  it('checkout 実行中(lockGlobal 保持中)は push が no-op になる', async () => {
    let resolveCheckout: () => void = () => {}
    mockCheckoutBranch.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveCheckout = resolve
        })
    )
    mockPush.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => {
      const lock = useFileOperationLock()
      const branchOps = useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, lock)
      const remoteOps = useGitRemoteOperations(repoStatus, refreshGitStatus, lock)
      return { branchOps, remoteOps }
    })

    let checkoutPromise: Promise<boolean> = Promise.resolve(false)
    act(() => {
      checkoutPromise = result.current.branchOps.checkoutBranch('feature/x')
    })

    await act(async () => {
      await result.current.remoteOps.push()
    })
    expect(mockPush).not.toHaveBeenCalled()

    await act(async () => {
      resolveCheckout()
      await checkoutPromise
    })
  })

  it('push 実行中でも checkoutBranch は実行できる(排他対象外)', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolvePush = resolve
        })
    )
    mockCheckoutBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => {
      const lock = useFileOperationLock()
      const branchOps = useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, lock)
      const remoteOps = useGitRemoteOperations(repoStatus, refreshGitStatus, lock)
      return { branchOps, remoteOps }
    })

    act(() => {
      void result.current.remoteOps.push()
    })
    expect(result.current.remoteOps.isPushing).toBe(true)

    await act(async () => {
      await result.current.branchOps.checkoutBranch('feature/x')
    })
    expect(mockCheckoutBranch).toHaveBeenCalledOnce()

    await act(async () => {
      resolvePush()
    })
  })
})

describe('createBranch', () => {
  it('gitApi.createBranch を呼び、成功したら true を返して一覧を再取得する', async () => {
    mockCreateBranch.mockResolvedValue(undefined)
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, makeFileLock())
    )
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.createBranch('feature/new')
    })
    expect(succeeded).toBe(true)
    expect(mockCreateBranch).toHaveBeenCalledWith('feature/new')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // HEAD の参照先を変えるため checkout と同じく全体ロックを取る。これにより
  // push 側の既存の判定(lock.isAnyLocked())で「作成中の push」が自動的に防がれる
  it('実行中は lockGlobal を取り、完了後に unlockGlobal する', async () => {
    mockCreateBranch.mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        lock
      )
    )
    await act(async () => {
      await result.current.createBranch('feature/new')
    })
    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('実行中は pendingBranchOperation が create になり、完了後 null に戻る', async () => {
    let resolveCreate: () => void = () => {}
    mockCreateBranch.mockReturnValue(new Promise<void>((r) => (resolveCreate = r)))
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        makeFileLock()
      )
    )
    let pending: Promise<boolean> = Promise.resolve(false)
    act(() => {
      pending = result.current.createBranch('feature/new')
    })
    expect(result.current.pendingBranchOperation).toBe('create')
    await act(async () => {
      resolveCreate()
      await pending
    })
    expect(result.current.pendingBranchOperation).toBeNull()
  })

  it('失敗したら false を返し、branchOperationError に反映する', async () => {
    mockCreateBranch.mockRejectedValue(new Error('同じ名前のブランチが既に存在します: main'))
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        makeFileLock()
      )
    )
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.createBranch('main')
    })
    expect(succeeded).toBe(false)
    expect(result.current.branchOperationError?.message).toBe(
      '同じ名前のブランチが既に存在します: main'
    )
  })

  // 他の条件(isAnyLocked)が偶然真にならない固定モックで、ブランチ操作どうしの
  // 排他だけを検証する(パターン16)
  it('checkout の実行中は createBranch を呼ばない', async () => {
    mockCheckoutBranch.mockReturnValue(new Promise<void>(() => {}))
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        makeFileLock()
      )
    )
    act(() => {
      void result.current.checkoutBranch('feature/x')
    })
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.createBranch('feature/new')
    })
    expect(succeeded).toBe(false)
    expect(mockCreateBranch).not.toHaveBeenCalled()
  })

  it('他操作中(lock.isAnyLocked())は createBranch を呼ばない', async () => {
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        lock
      )
    )
    await act(async () => {
      await result.current.createBranch('feature/new')
    })
    expect(mockCreateBranch).not.toHaveBeenCalled()
  })
})
