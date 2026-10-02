import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult, MergeBranchResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitBranchOperations } from '../useGitBranchOperations'
import type { GitBranchOperationsState } from '../useGitBranchOperations'
import { useGitRemoteOperations } from '../useGitRemoteOperations'
import { useFileOperationLock } from '../useFileOperationLock'
import type { FileOperationLock } from '../useFileOperationLock'

const mockCheckoutBranch = vi.mocked(gitApi.checkoutBranch)
const mockCreateBranch = vi.mocked(gitApi.createBranch)
const mockDeleteBranch = vi.mocked(gitApi.deleteBranch)
const mockMergeBranch = vi.mocked(gitApi.mergeBranch)
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

describe('deleteBranch', () => {
  const FIRST = 'ブランチ feature/x を削除しますか？'
  const SECOND =
    'ブランチ feature/x にはマージされていないコミットがあります。強制削除するとこれらのコミットは失われます。削除しますか？'

  const renderWithConfirm = (
    onConfirm: (message: string) => boolean,
    lock = makeFileLock()
  ): ReturnType<typeof renderHook<GitBranchOperationsState, never>> =>
    renderHook(() =>
      useGitBranchOperations(
        repoStatus,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        lock,
        { onConfirm }
      )
    )

  it('1回目の確認でキャンセルしたら削除 API を呼ばずに false を返す', async () => {
    const onConfirm = vi.fn().mockReturnValue(false)
    const { result } = renderWithConfirm(onConfirm)
    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(false)
    expect(onConfirm).toHaveBeenCalledWith(FIRST)
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  it('マージ済みなら安全削除だけで完了し、2回目の確認は出さない', async () => {
    mockDeleteBranch.mockResolvedValue({ deleted: true })
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderWithConfirm(onConfirm)
    let deleted = false
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(true)
    expect(mockDeleteBranch).toHaveBeenCalledExactlyOnceWith('feature/x', false)
    expect(onConfirm).toHaveBeenCalledOnce()
  })

  it('未マージなら2回目の確認を出し、承諾されたら強制削除する', async () => {
    mockDeleteBranch
      .mockResolvedValueOnce({ deleted: false, reason: 'not-fully-merged' })
      .mockResolvedValueOnce({ deleted: true })
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderWithConfirm(onConfirm)
    let deleted = false
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(true)
    expect(onConfirm).toHaveBeenNthCalledWith(1, FIRST)
    expect(onConfirm).toHaveBeenNthCalledWith(2, SECOND)
    expect(mockDeleteBranch).toHaveBeenNthCalledWith(1, 'feature/x', false)
    expect(mockDeleteBranch).toHaveBeenNthCalledWith(2, 'feature/x', true)
  })

  it('未マージで2回目の確認をキャンセルしたら強制削除せず、エラーも出さずに false を返す', async () => {
    mockDeleteBranch.mockResolvedValue({ deleted: false, reason: 'not-fully-merged' })
    const onConfirm = vi.fn().mockReturnValueOnce(true).mockReturnValueOnce(false)
    const { result } = renderWithConfirm(onConfirm)
    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(false)
    expect(mockDeleteBranch).toHaveBeenCalledExactlyOnceWith('feature/x', false)
    expect(result.current.branchOperationError).toBeNull()
  })

  // 削除するのは現在ではないブランチの ref だけで、working tree/index/HEAD に
  // 触れないため、push/pull を待たせる必要はない(パターン23)
  it('lockGlobal を取らない', async () => {
    mockDeleteBranch.mockResolvedValue({ deleted: true })
    const lock = makeFileLock()
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true), lock)
    await act(async () => {
      await result.current.deleteBranch('feature/x')
    })
    expect(lock.lockGlobal).not.toHaveBeenCalled()
  })

  // 安全削除と強制削除の間に他のブランチ操作が割り込まないこと。onConfirm の中で
  // result.current を読む方式は act 外での state 反映タイミングに依存し実装に
  // 関係なく成否が決まってしまうため、代わりに「2回目の確認中に checkoutBranch を
  // 呼んでも無視される(busy ref が真のまま)」ことで排他中であることを検証する
  it('安全削除と強制削除の間も他のブランチ操作は割り込めない', async () => {
    mockDeleteBranch
      .mockResolvedValueOnce({ deleted: false, reason: 'not-fully-merged' })
      .mockResolvedValueOnce({ deleted: true })
    const onConfirm = vi.fn((message: string) => {
      if (message === SECOND) {
        void result.current.checkoutBranch('feature/y')
      }
      return true
    })
    const { result } = renderWithConfirm(onConfirm)
    await act(async () => {
      await result.current.deleteBranch('feature/x')
    })
    expect(mockCheckoutBranch).not.toHaveBeenCalled()
  })

  it('削除 API が失敗したら false を返し、branchOperationError に反映する', async () => {
    mockDeleteBranch.mockRejectedValue(
      new Error('他のワークツリーで使用中のブランチは削除できません: feature/x')
    )
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true))
    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(false)
    expect(result.current.branchOperationError?.message).toBe(
      '他のワークツリーで使用中のブランチは削除できません: feature/x'
    )
  })

  it('他のブランチ操作の実行中は削除 API を呼ばない', async () => {
    mockCheckoutBranch.mockReturnValue(new Promise<void>(() => {}))
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true))
    act(() => {
      void result.current.checkoutBranch('feature/y')
    })
    await act(async () => {
      await result.current.deleteBranch('feature/x')
    })
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  // checkout/create と同じく、削除も他の操作(ハンク操作/commit/amend/pull)が
  // lock を握っている間は開始しない(パターン23)
  it('他の操作が file lock を握っている間は削除 API を呼ばない', async () => {
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true), lock)
    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(false)
    expect(mockDeleteBranch).not.toHaveBeenCalled()
  })

  it('未マージの強制削除が失敗したら false を返し、branchOperationError に反映する', async () => {
    mockDeleteBranch
      .mockResolvedValueOnce({ deleted: false, reason: 'not-fully-merged' })
      .mockRejectedValueOnce(new Error('force failed'))
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderWithConfirm(onConfirm)
    let deleted = true
    await act(async () => {
      deleted = await result.current.deleteBranch('feature/x')
    })
    expect(deleted).toBe(false)
    expect(result.current.branchOperationError?.message).toBe('force failed')
  })
})

describe('mergeBranch', () => {
  const MESSAGE =
    'feature/x を main にマージしますか？\n\nコンフリクトした場合はマージ中の状態で止まります。解決するか、マージを中止できます。'

  const renderWithConfirm = (
    onConfirm: (message: string) => boolean,
    lock = makeFileLock(),
    refreshGitStatus = vi.fn().mockResolvedValue(undefined),
    refreshHistory = vi.fn().mockResolvedValue(undefined)
  ): ReturnType<typeof renderHook<GitBranchOperationsState, never>> =>
    renderHook(() =>
      useGitBranchOperations(repoStatus, refreshGitStatus, refreshHistory, lock, { onConfirm })
    )

  it('確認でキャンセルしたらマージ API を呼ばずに false を返す', async () => {
    const onConfirm = vi.fn().mockReturnValue(false)
    const { result } = renderWithConfirm(onConfirm)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(false)
    expect(onConfirm).toHaveBeenCalledWith(MESSAGE)
    expect(mockMergeBranch).not.toHaveBeenCalled()
  })

  // マージは現在のブランチ名が分からないので、確認ダイアログも出さずに終える
  it('リポジトリが無いときは確認ダイアログも出さずに false を返す', async () => {
    const onConfirm = vi.fn().mockReturnValue(true)
    const { result } = renderHook(() =>
      useGitBranchOperations(
        null,
        vi.fn().mockResolvedValue(undefined),
        vi.fn().mockResolvedValue(undefined),
        makeFileLock(),
        { onConfirm }
      )
    )
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(false)
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('確認後にマージ API を呼び、成功したら true を返して一覧を再取得する', async () => {
    mockMergeBranch.mockResolvedValue({ status: 'merged' })
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const refreshHistory = vi.fn().mockResolvedValue(undefined)
    const { result } = renderWithConfirm(
      vi.fn().mockReturnValue(true),
      makeFileLock(),
      refreshGitStatus,
      refreshHistory
    )
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(true)
    expect(mockMergeBranch).toHaveBeenCalledWith('feature/x')
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // マージは working tree/index/HEAD を書き換えるため checkout と同じく全体ロックを取る。
  // これにより push 側の既存の判定(lock.isAnyLocked())で「マージ中の push」が自動的に防がれる
  it('実行中は lockGlobal を取り、完了後に unlockGlobal する', async () => {
    mockMergeBranch.mockResolvedValue({ status: 'merged' })
    const lock = makeFileLock()
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true), lock)
    await act(async () => {
      await result.current.mergeBranch('feature/x')
    })
    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('実行中は pendingBranchOperation が merge になり、完了後 null に戻る', async () => {
    let resolveMerge: () => void = () => {}
    mockMergeBranch.mockReturnValue(
      new Promise<MergeBranchResult>((r) => (resolveMerge = () => r({ status: 'merged' })))
    )
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true))
    act(() => {
      void result.current.mergeBranch('feature/x')
    })
    expect(result.current.pendingBranchOperation).toBe('merge')
    await act(async () => {
      resolveMerge()
    })
    expect(result.current.pendingBranchOperation).toBeNull()
  })

  // 作業ツリーが変わった(マーカー入りになった)ため、true を返して呼び出し元にタブの再読込をさせる。
  // runOperation は execute の成功時に error を null にするため、メッセージは実行完了後にセットする
  it('コンフリクトの結果は true を返し、branchOperationError にメッセージを残して一覧を再取得する', async () => {
    const message = 'コンフリクトしました（a.txt）。解決するか、マージを中止してください'
    mockMergeBranch.mockResolvedValue({ status: 'conflict', message })
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const lock = makeFileLock()
    const { result } = renderWithConfirm(
      vi.fn().mockReturnValue(true),
      lock,
      refreshGitStatus,
      vi.fn().mockResolvedValue(undefined)
    )
    let succeeded = false
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(true)
    expect(result.current.branchOperationError?.message).toBe(message)
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  // コンフリクトの通知はマージ中(gitStatus.mergeInProgress)に連動して消える。バナーの完了・中止だけでなく、
  // コミット欄でのマージの完了や CLI での merge --abort でも MERGE_HEAD が無くなるため
  describe('マージ中の状態に連動したコンフリクト通知の消去', () => {
    const conflictMessage = 'コンフリクトしました（a.txt）。解決するか、マージを中止してください'
    const renderWithStatus = (
      initial: GitStatusResult
    ): ReturnType<typeof renderHook<GitBranchOperationsState, { status: GitStatusResult }>> =>
      renderHook(
        ({ status }: { status: GitStatusResult }) =>
          useGitBranchOperations(
            status,
            vi.fn().mockResolvedValue(undefined),
            vi.fn().mockResolvedValue(undefined),
            makeFileLock(),
            { onConfirm: vi.fn().mockReturnValue(true) }
          ),
        { initialProps: { status: initial } }
      )
    const merging: GitStatusResult = { ...repoStatus, mergeInProgress: true }

    it('コンフリクト後にマージ中でなくなる(コミット欄での完了・外部の中止)と、通知が消える', async () => {
      mockMergeBranch.mockResolvedValue({ status: 'conflict', message: conflictMessage })
      const { result, rerender } = renderWithStatus(repoStatus)
      await act(async () => {
        await result.current.mergeBranch('feature/x')
      })
      rerender({ status: merging })
      expect(result.current.branchOperationError?.message).toBe(conflictMessage)
      rerender({ status: { ...repoStatus } })
      expect(result.current.branchOperationError).toBeNull()
    })

    it('マージ中のまま(状態の再取得だけ)では、通知は消えない', async () => {
      mockMergeBranch.mockResolvedValue({ status: 'conflict', message: conflictMessage })
      const { result, rerender } = renderWithStatus(repoStatus)
      await act(async () => {
        await result.current.mergeBranch('feature/x')
      })
      rerender({ status: merging })
      rerender({ status: { ...merging } })
      expect(result.current.branchOperationError?.message).toBe(conflictMessage)
    })

    it('無関係なブランチ操作のエラーは、マージ中でなくなっても消えない', async () => {
      mockCheckoutBranch.mockRejectedValue(new Error('checkout に失敗しました'))
      const { result, rerender } = renderWithStatus(merging)
      await act(async () => {
        await result.current.checkoutBranch('feature/x')
      })
      expect(result.current.branchOperationError?.message).toBe('checkout に失敗しました')
      rerender({ status: repoStatus })
      expect(result.current.branchOperationError?.message).toBe('checkout に失敗しました')
    })

    it('コンフリクトの通知が別の操作のエラーに置き換わった後は、マージ中でなくなっても消えない', async () => {
      mockMergeBranch.mockResolvedValue({ status: 'conflict', message: conflictMessage })
      mockCheckoutBranch.mockRejectedValue(new Error('checkout に失敗しました'))
      const { result, rerender } = renderWithStatus(repoStatus)
      await act(async () => {
        await result.current.mergeBranch('feature/x')
      })
      rerender({ status: merging })
      await act(async () => {
        await result.current.checkoutBranch('feature/y')
      })
      rerender({ status: repoStatus })
      expect(result.current.branchOperationError?.message).toBe('checkout に失敗しました')
    })
  })

  // コンフリクトは例外ではなく { status: 'conflict' } で返る。throw されるのは事前検証の失敗等
  it('失敗したら false を返し、branchOperationError に反映してロックを解除する', async () => {
    mockMergeBranch.mockRejectedValue(
      new Error('未コミットの変更があるためマージできません。先にコミットしてください')
    )
    const lock = makeFileLock()
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true), lock)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(false)
    expect(result.current.branchOperationError?.message).toBe(
      '未コミットの変更があるためマージできません。先にコミットしてください'
    )
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('他の操作が file lock を握っている間はマージ API を呼ばない', async () => {
    const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result } = renderWithConfirm(vi.fn().mockReturnValue(true), lock)
    let succeeded = true
    await act(async () => {
      succeeded = await result.current.mergeBranch('feature/x')
    })
    expect(succeeded).toBe(false)
    expect(mockMergeBranch).not.toHaveBeenCalled()
  })
})

// checkout/作成/削除/マージは同じ開始条件(isBranchOperationBusy)を共有する。リポジトリが無い
// 状態(gitStatus が null)では、どの操作も git API を呼ばずに false を返すこと
describe('共通の開始条件', () => {
  it.each([
    ['checkoutBranch', () => mockCheckoutBranch],
    ['createBranch', () => vi.mocked(gitApi.createBranch)],
    ['deleteBranch', () => vi.mocked(gitApi.deleteBranch)],
    ['mergeBranch', () => vi.mocked(gitApi.mergeBranch)]
  ] as const)(
    'リポジトリが無いとき %s は git API を呼ばずに false を返す',
    async (method, getApiMock) => {
      const { result } = renderHook(() =>
        useGitBranchOperations(
          null,
          vi.fn().mockResolvedValue(undefined),
          vi.fn().mockResolvedValue(undefined),
          makeFileLock(),
          { onConfirm: vi.fn().mockReturnValue(true) }
        )
      )
      let succeeded = true
      await act(async () => {
        succeeded = await result.current[method]('feature/x')
      })
      expect(succeeded).toBe(false)
      expect(getApiMock()).not.toHaveBeenCalled()
      expect(result.current.pendingBranchOperation).toBeNull()
    }
  )

  it.each(['checkoutBranch', 'createBranch', 'deleteBranch', 'mergeBranch'] as const)(
    '作成の実行中は %s を呼んでも git API を呼ばない',
    async (method) => {
      vi.mocked(gitApi.createBranch).mockReturnValue(new Promise<void>(() => {}))
      const { result } = renderHook(() =>
        useGitBranchOperations(
          repoStatus,
          vi.fn().mockResolvedValue(undefined),
          vi.fn().mockResolvedValue(undefined),
          makeFileLock(),
          { onConfirm: vi.fn().mockReturnValue(true) }
        )
      )
      act(() => {
        void result.current.createBranch('feature/busy')
      })
      vi.mocked(gitApi.createBranch).mockClear()
      await act(async () => {
        await result.current[method]('feature/x')
      })
      expect(mockCheckoutBranch).not.toHaveBeenCalled()
      expect(gitApi.createBranch).not.toHaveBeenCalled()
      expect(gitApi.deleteBranch).not.toHaveBeenCalled()
      expect(gitApi.mergeBranch).not.toHaveBeenCalled()
      expect(result.current.pendingBranchOperation).toBe('create')
    }
  )

  it.each(['checkoutBranch', 'createBranch', 'deleteBranch'] as const)(
    'マージの実行中は %s を呼んでも git API を呼ばない',
    async (method) => {
      vi.mocked(gitApi.mergeBranch).mockReturnValue(new Promise<MergeBranchResult>(() => {}))
      const { result } = renderHook(() =>
        useGitBranchOperations(
          repoStatus,
          vi.fn().mockResolvedValue(undefined),
          vi.fn().mockResolvedValue(undefined),
          makeFileLock(),
          { onConfirm: vi.fn().mockReturnValue(true) }
        )
      )
      act(() => {
        void result.current.mergeBranch('feature/busy')
      })
      await act(async () => {
        await result.current[method]('feature/x')
      })
      expect(mockCheckoutBranch).not.toHaveBeenCalled()
      expect(gitApi.createBranch).not.toHaveBeenCalled()
      expect(gitApi.deleteBranch).not.toHaveBeenCalled()
      expect(result.current.pendingBranchOperation).toBe('merge')
    }
  )
})
