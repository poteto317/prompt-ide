import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitFileStatus, GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { MERGE_ABORT_CONFIRM_MESSAGE } from '../../lib/mergeStateMessage'
import { useMergeState } from '../useMergeState'
import type { MergeStateOptions } from '../useMergeState'
import type { FileOperationLock } from '../useFileOperationLock'
import type { MergeStatePanelState } from '../../types'

const mockAbortMerge = vi.mocked(gitApi.abortMerge)
const mockCompleteMerge = vi.mocked(gitApi.completeMerge)

const makeFileLock = (overrides: Partial<FileOperationLock> = {}): FileOperationLock => ({
  isLocked: vi.fn().mockReturnValue(false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn().mockReturnValue(false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn(),
  ...overrides
})

const conflictedBoth: GitFileStatus = { path: 'a.txt', index: 'U', workingDir: 'U' }
const conflictedAA: GitFileStatus = { path: 'b.txt', index: 'A', workingDir: 'A' }
const modified: GitFileStatus = { path: 'c.txt', index: ' ', workingDir: 'M' }

const makeStatus = (
  files: GitFileStatus[],
  overrides: Partial<GitStatusResult> = {}
): GitStatusResult => ({
  isRepo: true,
  mergeInProgress: true,
  hasOrigin: true,
  hasRemote: true,
  upstream: 'origin/main',
  detached: false,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files,
  ...overrides
})

const setup = (
  overrides: Partial<MergeStateOptions> = {}
): RenderHookResult<MergeStatePanelState, unknown> & { options: MergeStateOptions } => {
  const options: MergeStateOptions = {
    gitStatus: makeStatus([conflictedBoth, conflictedAA, modified]),
    refreshGitStatus: vi.fn().mockResolvedValue(undefined),
    refreshHistory: vi.fn().mockResolvedValue(undefined),
    fileLock: makeFileLock(),
    confirmDiscardAnyDirty: vi.fn().mockReturnValue(true),
    reloadOpenFiles: vi.fn().mockResolvedValue(undefined),
    refreshTree: vi.fn().mockResolvedValue(true),
    onConfirm: vi.fn().mockReturnValue(true),
    ...overrides
  }
  const hook = renderHook(() => useMergeState(options))
  return { ...hook, options }
}

const resolvedStatus = makeStatus([modified])

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useMergeState: 状態の導出', () => {
  it('mergeInProgress と、コンフリクト中のファイルの件数から導出する', () => {
    const { result } = setup()
    expect(result.current.inProgress).toBe(true)
    expect(result.current.unresolvedCount).toBe(2)
    expect(result.current.canComplete).toBe(false)
    expect(result.current.pendingOperation).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('未解決が 0 件でマージ中なら完了できる', () => {
    const { result } = setup({ gitStatus: resolvedStatus })
    expect(result.current.unresolvedCount).toBe(0)
    expect(result.current.canComplete).toBe(true)
  })

  it('マージ中でなければ完了できない', () => {
    const { result } = setup({ gitStatus: makeStatus([modified], { mergeInProgress: false }) })
    expect(result.current.inProgress).toBe(false)
    expect(result.current.canComplete).toBe(false)
  })

  it('gitStatus が null なら inProgress は false で件数は 0', () => {
    const { result } = setup({ gitStatus: null })
    expect(result.current.inProgress).toBe(false)
    expect(result.current.unresolvedCount).toBe(0)
    expect(result.current.canComplete).toBe(false)
  })
})

describe('useMergeState: onAbort', () => {
  it('中止の確認を拒否するとロックを取らず abortMerge を呼ばない', async () => {
    const { result, options } = setup({ onConfirm: vi.fn().mockReturnValue(false) })
    await act(async () => {
      await result.current.onAbort()
    })
    expect(options.onConfirm).toHaveBeenCalledWith(MERGE_ABORT_CONFIRM_MESSAGE)
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    expect(mockAbortMerge).not.toHaveBeenCalled()
    expect(options.reloadOpenFiles).not.toHaveBeenCalled()
  })

  it('未保存編集の破棄を拒否すると何もしない', async () => {
    const { result, options } = setup({ confirmDiscardAnyDirty: vi.fn().mockReturnValue(false) })
    await act(async () => {
      await result.current.onAbort()
    })
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    expect(mockAbortMerge).not.toHaveBeenCalled()
    expect(options.reloadOpenFiles).not.toHaveBeenCalled()
  })

  it('成功すると lockGlobal → abortMerge → unlockGlobal し、タブとツリーを再読込する', async () => {
    const order: string[] = []
    mockAbortMerge.mockImplementation(async () => {
      order.push('abort')
    })
    const fileLock = makeFileLock({
      lockGlobal: vi.fn(() => order.push('lock')),
      unlockGlobal: vi.fn(() => order.push('unlock'))
    })
    const { result, options } = setup({ fileLock })
    await act(async () => {
      await result.current.onAbort()
    })
    expect(order).toEqual(['lock', 'abort', 'unlock'])
    expect(options.refreshGitStatus).toHaveBeenCalled()
    expect(options.refreshHistory).toHaveBeenCalled()
    expect(options.reloadOpenFiles).toHaveBeenCalledTimes(1)
    expect(options.refreshTree).toHaveBeenCalledTimes(1)
    expect(result.current.error).toBeNull()
    expect(result.current.pendingOperation).toBeNull()
  })

  it('実行中は pendingOperation が abort になる', async () => {
    let resolveAbort: () => void = () => undefined
    mockAbortMerge.mockReturnValue(new Promise<void>((r) => (resolveAbort = r)))
    const { result } = setup()
    let promise: Promise<void> = Promise.resolve()
    act(() => {
      promise = result.current.onAbort()
    })
    expect(result.current.pendingOperation).toBe('abort')
    await act(async () => {
      resolveAbort()
      await promise
    })
    expect(result.current.pendingOperation).toBeNull()
  })

  it('失敗すると error をセットし、再読込せずロックを解放する', async () => {
    mockAbortMerge.mockRejectedValue(new Error('中止できない'))
    const { result, options } = setup()
    await act(async () => {
      await result.current.onAbort()
    })
    expect(result.current.error?.message).toBe('中止できない')
    expect(options.reloadOpenFiles).not.toHaveBeenCalled()
    expect(options.refreshTree).not.toHaveBeenCalled()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledTimes(1)
  })

  it('次の成功で error が消える', async () => {
    mockAbortMerge.mockRejectedValueOnce(new Error('失敗')).mockResolvedValueOnce(undefined)
    const { result } = setup()
    await act(async () => {
      await result.current.onAbort()
    })
    expect(result.current.error).not.toBeNull()
    await act(async () => {
      await result.current.onAbort()
    })
    expect(result.current.error).toBeNull()
  })

  it('他の操作がロック中なら確認も出さず何もしない', async () => {
    const { result, options } = setup({
      fileLock: makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    })
    await act(async () => {
      await result.current.onAbort()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(mockAbortMerge).not.toHaveBeenCalled()
  })

  it('リポジトリが無いときは何もしない', async () => {
    const { result, options } = setup({ gitStatus: { ...makeStatus([]), isRepo: false } })
    await act(async () => {
      await result.current.onAbort()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(mockAbortMerge).not.toHaveBeenCalled()
  })

  it('マージ中でなければ何もしない', async () => {
    const { result, options } = setup({
      gitStatus: makeStatus([modified], { mergeInProgress: false })
    })
    await act(async () => {
      await result.current.onAbort()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(mockAbortMerge).not.toHaveBeenCalled()
  })

  it('実行中の多重実行は無視する', async () => {
    let resolveAbort: () => void = () => undefined
    mockAbortMerge.mockReturnValue(new Promise<void>((r) => (resolveAbort = r)))
    const { result } = setup()
    let first: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.onAbort()
    })
    await act(async () => {
      await result.current.onAbort()
    })
    expect(mockAbortMerge).toHaveBeenCalledTimes(1)
    await act(async () => {
      resolveAbort()
      await first
    })
  })
})

describe('useMergeState: onComplete', () => {
  it('完了できない(未解決あり)なら何もしない', async () => {
    const { result, options } = setup()
    await act(async () => {
      await result.current.onComplete()
    })
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    expect(mockCompleteMerge).not.toHaveBeenCalled()
  })

  it('未保存編集の破棄を拒否するとロックを取らず何もしない', async () => {
    const { result, options } = setup({
      gitStatus: resolvedStatus,
      confirmDiscardAnyDirty: vi.fn().mockReturnValue(false)
    })
    await act(async () => {
      await result.current.onComplete()
    })
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    expect(mockCompleteMerge).not.toHaveBeenCalled()
  })

  it('成功すると lockGlobal → completeMerge → unlockGlobal し、再読込する(確認ダイアログは出さない)', async () => {
    const order: string[] = []
    mockCompleteMerge.mockImplementation(async () => {
      order.push('complete')
    })
    const fileLock = makeFileLock({
      lockGlobal: vi.fn(() => order.push('lock')),
      unlockGlobal: vi.fn(() => order.push('unlock'))
    })
    const { result, options } = setup({ gitStatus: resolvedStatus, fileLock })
    await act(async () => {
      await result.current.onComplete()
    })
    expect(order).toEqual(['lock', 'complete', 'unlock'])
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(options.refreshGitStatus).toHaveBeenCalled()
    expect(options.refreshHistory).toHaveBeenCalled()
    expect(options.reloadOpenFiles).toHaveBeenCalledTimes(1)
    expect(options.refreshTree).toHaveBeenCalledTimes(1)
  })

  it('実行中は pendingOperation が complete になる', async () => {
    let resolveComplete: () => void = () => undefined
    mockCompleteMerge.mockReturnValue(new Promise<void>((r) => (resolveComplete = r)))
    const { result } = setup({ gitStatus: resolvedStatus })
    let promise: Promise<void> = Promise.resolve()
    act(() => {
      promise = result.current.onComplete()
    })
    expect(result.current.pendingOperation).toBe('complete')
    await act(async () => {
      resolveComplete()
      await promise
    })
    expect(result.current.pendingOperation).toBeNull()
  })

  it('失敗すると error をセットし、再読込せずロックを解放する', async () => {
    mockCompleteMerge.mockRejectedValue(new Error('完了できない'))
    const { result, options } = setup({ gitStatus: resolvedStatus })
    await act(async () => {
      await result.current.onComplete()
    })
    expect(result.current.error?.message).toBe('完了できない')
    expect(options.reloadOpenFiles).not.toHaveBeenCalled()
    expect(options.refreshTree).not.toHaveBeenCalled()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledTimes(1)
  })

  it('他の操作がロック中なら何もしない', async () => {
    const { result, options } = setup({
      gitStatus: resolvedStatus,
      fileLock: makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    })
    await act(async () => {
      await result.current.onComplete()
    })
    expect(mockCompleteMerge).not.toHaveBeenCalled()
    expect(options.reloadOpenFiles).not.toHaveBeenCalled()
  })
})
