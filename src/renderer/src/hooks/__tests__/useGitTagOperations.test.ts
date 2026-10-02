import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CreateTagRequest, GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitTagOperations } from '../useGitTagOperations'
import type { GitTagPanelState } from '../../types'
import type { FileOperationLock } from '../useFileOperationLock'

const mockCreateTag = vi.mocked(gitApi.createTag)

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
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: []
}
const request: CreateTagRequest = { name: 'v1.0.0', kind: 'annotated', message: 'リリース' }

const setup = (
  overrides: {
    status?: GitStatusResult | null
    lock?: FileOperationLock
    refreshHistory?: () => Promise<void>
  } = {}
): RenderHookResult<GitTagPanelState, unknown> & {
  refreshHistory: () => Promise<void>
  lock: FileOperationLock
} => {
  const refreshHistory =
    overrides.refreshHistory ?? vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  const lock = overrides.lock ?? makeFileLock()
  const hook = renderHook(() =>
    useGitTagOperations(
      overrides.status === undefined ? repoStatus : overrides.status,
      refreshHistory,
      lock
    )
  )
  return { ...hook, refreshHistory, lock }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useGitTagOperations', () => {
  it('createTag を要求で呼び、成功したら true を返して履歴(ログ・ブランチ・タグ)を再取得する', async () => {
    mockCreateTag.mockResolvedValue(undefined)
    const { result, refreshHistory } = setup()
    let ok = false
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(true)
    expect(mockCreateTag).toHaveBeenCalledWith(request)
    expect(refreshHistory).toHaveBeenCalledOnce()
    expect(result.current.error).toBeNull()
  })

  // ref を 1 つ増やすだけで、push / pull / ブランチ操作と読み書きする対象が重ならない(設計書)
  it('lockGlobal は取らない', async () => {
    mockCreateTag.mockResolvedValue(undefined)
    const { result, lock } = setup()
    await act(async () => {
      await result.current.createTag(request)
    })
    expect(lock.lockGlobal).not.toHaveBeenCalled()
    expect(lock.unlockGlobal).not.toHaveBeenCalled()
  })

  it('実行中は isCreating が true で、再取得が終わってから false に戻る', async () => {
    let resolveCreate: () => void = () => {}
    let resolveRefresh: () => void = () => {}
    mockCreateTag.mockReturnValue(new Promise<void>((r) => (resolveCreate = r)))
    const refreshHistory = vi
      .fn<() => Promise<void>>()
      .mockReturnValue(new Promise<void>((r) => (resolveRefresh = r)))
    const { result } = setup({ refreshHistory })
    act(() => {
      void result.current.createTag(request)
    })
    expect(result.current.isCreating).toBe(true)
    await act(async () => {
      resolveCreate()
    })
    // 再取得の途中はまだ実行中(古い一覧のまま操作させない。パターン 73)
    expect(result.current.isCreating).toBe(true)
    await act(async () => {
      resolveRefresh()
    })
    expect(result.current.isCreating).toBe(false)
  })

  // 失敗しても、他のプロセスが作ったタグ等を反映するため再取得する(パターン 73)
  it('失敗したら false を返し、error に反映して、履歴も再取得する', async () => {
    mockCreateTag.mockRejectedValue(new Error('同じ名前のタグが既に存在します: v1.0.0'))
    const { result, refreshHistory } = setup()
    let ok = true
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(false)
    expect(result.current.error?.message).toBe('同じ名前のタグが既に存在します: v1.0.0')
    expect(result.current.isCreating).toBe(false)
    expect(refreshHistory).toHaveBeenCalledOnce()
  })

  // 再取得の失敗で、作成の成功を失敗にしない(パターン 52)
  it('作成に成功して再取得が失敗しても true を返し、error は null のまま', async () => {
    mockCreateTag.mockResolvedValue(undefined)
    const refreshHistory = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('log failed'))
    const { result } = setup({ refreshHistory })
    let ok = false
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(true)
    expect(result.current.error).toBeNull()
  })

  it('実行中にもう一度呼ぶと、二重に作成せず false を返す', async () => {
    let resolveCreate: () => void = () => {}
    mockCreateTag.mockReturnValue(new Promise<void>((r) => (resolveCreate = r)))
    const { result } = setup()
    let second = true
    await act(async () => {
      void result.current.createTag(request)
      second = await result.current.createTag(request)
    })
    expect(second).toBe(false)
    expect(mockCreateTag).toHaveBeenCalledOnce()
    await act(async () => {
      resolveCreate()
    })
  })

  // checkout・マージ・commit の途中は HEAD が動くため、付ける先が定まるまで実行しない
  it('他の Git 操作がロックを持っている間は実行せず false を返す', async () => {
    const { result, refreshHistory } = setup({
      lock: makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    })
    let ok = true
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(false)
    expect(mockCreateTag).not.toHaveBeenCalled()
    expect(refreshHistory).not.toHaveBeenCalled()
  })

  it.each([
    ['null', null],
    ['リポジトリでない', { ...repoStatus, isRepo: false }]
  ])('gitStatus が %s の間は実行せず false を返す', async (_label, status) => {
    const { result } = setup({ status })
    let ok = true
    await act(async () => {
      ok = await result.current.createTag(request)
    })
    expect(ok).toBe(false)
    expect(mockCreateTag).not.toHaveBeenCalled()
  })

  it('失敗の後に成功すると error が消える', async () => {
    mockCreateTag.mockRejectedValueOnce(new Error('失敗')).mockResolvedValueOnce(undefined)
    const { result } = setup()
    await act(async () => {
      await result.current.createTag(request)
    })
    expect(result.current.error?.message).toBe('失敗')
    await act(async () => {
      await result.current.createTag(request)
    })
    expect(result.current.error).toBeNull()
  })

  // 再試行の作成中に前回のエラー(role="alert")が残ると、作成中の案内(role="status")と同時に出る。
  // 同じ文言で再び失敗したときに alert の DOM が変わらず読み上げられないため、開始時に消す(PR #41 の 3 周目のレビュー)
  it('失敗の後に再試行すると、作成中は error が null になり、同じ文言で再び失敗すると error がセットされる', async () => {
    let rejectSecond: (err: Error) => void = () => {}
    mockCreateTag
      .mockRejectedValueOnce(new Error('タグを作成できませんでした: x'))
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => (rejectSecond = reject)))
    const { result } = setup()
    await act(async () => {
      await result.current.createTag(request)
    })
    expect(result.current.error?.message).toBe('タグを作成できませんでした: x')
    let second: Promise<boolean> = Promise.resolve(true)
    act(() => {
      second = result.current.createTag(request)
    })
    expect([result.current.isCreating, result.current.error]).toEqual([true, null])
    let ok = true
    await act(async () => {
      rejectSecond(new Error('タグを作成できませんでした: x'))
      ok = await second
    })
    expect(ok).toBe(false)
    expect(result.current.error?.message).toBe('タグを作成できませんでした: x')
  })

  it('失敗の後に再試行して成功すると、作成中も完了後も error は null', async () => {
    let resolveSecond: () => void = () => {}
    mockCreateTag
      .mockRejectedValueOnce(new Error('失敗'))
      .mockReturnValueOnce(new Promise<void>((r) => (resolveSecond = r)))
    const { result } = setup()
    await act(async () => {
      await result.current.createTag(request)
    })
    let second: Promise<boolean> = Promise.resolve(false)
    act(() => {
      second = result.current.createTag(request)
    })
    expect(result.current.error).toBeNull()
    let ok = false
    await act(async () => {
      resolveSecond()
      ok = await second
    })
    expect(ok).toBe(true)
    expect(result.current.error).toBeNull()
  })

  // 実行しない場合(実行中・ロック中)は、表示中のエラーを消さない(何も起きていないのに alert だけ消えない)
  it('ロック中で実行しないときは、前回の error を消さない', async () => {
    mockCreateTag.mockRejectedValue(new Error('失敗'))
    const isAnyLocked = vi.fn().mockReturnValue(false)
    const { result } = setup({ lock: makeFileLock({ isAnyLocked }) })
    await act(async () => {
      await result.current.createTag(request)
    })
    isAnyLocked.mockReturnValue(true)
    await act(async () => {
      await result.current.createTag(request)
    })
    expect(result.current.error?.message).toBe('失敗')
  })

  it('clearError で error を消す', async () => {
    mockCreateTag.mockRejectedValue(new Error('失敗'))
    const { result } = setup()
    await act(async () => {
      await result.current.createTag(request)
    })
    act(() => {
      result.current.clearError()
    })
    expect(result.current.error).toBeNull()
  })
})
