import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { DiscardAllResult, GitFileStatus, GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useDiscardAllChanges } from '../useDiscardAllChanges'
import type { DiscardAllChangesOptions } from '../useDiscardAllChanges'
import type { FileOperationLock } from '../useFileOperationLock'
import type { DiscardAllState } from '../../types'

const mockDiscardAll = vi.mocked(gitApi.discardAll)

const makeFileLock = (overrides: Partial<FileOperationLock> = {}): FileOperationLock => ({
  isLocked: vi.fn().mockReturnValue(false),
  lock: vi.fn(),
  unlock: vi.fn(),
  isAnyLocked: vi.fn().mockReturnValue(false),
  lockGlobal: vi.fn(),
  unlockGlobal: vi.fn(),
  ...overrides
})

const modified: GitFileStatus = { path: 'a.ts', index: ' ', workingDir: 'M' }
const deleted: GitFileStatus = { path: 'b.ts', index: ' ', workingDir: 'D' }
const untracked: GitFileStatus = { path: 'c.ts', index: '?', workingDir: '?' }
const staged: GitFileStatus = { path: 'd.ts', index: 'M', workingDir: ' ' }

const makeStatus = (files: GitFileStatus[]): GitStatusResult => ({
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files
})

const setup = (
  overrides: Partial<DiscardAllChangesOptions> = {}
): RenderHookResult<DiscardAllState, unknown> & { options: DiscardAllChangesOptions } => {
  const options: DiscardAllChangesOptions = {
    gitStatus: makeStatus([modified, deleted, untracked, staged]),
    refreshGitStatus: vi.fn().mockResolvedValue(undefined),
    fileLock: makeFileLock(),
    confirmDiscardAnyDirty: vi.fn().mockReturnValue(true),
    reloadOpenFiles: vi.fn().mockResolvedValue(undefined),
    refreshTree: vi.fn().mockResolvedValue(true),
    onConfirm: vi.fn().mockReturnValue(true),
    ...overrides
  }
  const hook = renderHook(() => useDiscardAllChanges(options))
  return { ...hook, options }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useDiscardAllChanges', () => {
  it('未ステージの件数とゴミ箱へ移す件数で確認を出す(ステージ済みのみのファイルは数えない)', async () => {
    mockDiscardAll.mockResolvedValue({ status: 'done' })
    const { result, options } = setup()
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      '変更 3 件を取り消しますか？この操作は元に戻せません。\nうち 1 件の未追跡ファイルはゴミ箱へ移動します。'
    )
  })

  it('ネストした git リポジトリ(sub/)があるときは、確認文言にフォルダ全体が移動する注意が入る', async () => {
    mockDiscardAll.mockResolvedValue({ status: 'done' })
    const nested: GitFileStatus = { path: 'sub/', index: '?', workingDir: '?' }
    const { result, options } = setup({ gitStatus: makeStatus([modified, untracked, nested]) })
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(options.onConfirm).toHaveBeenCalledWith(
      '変更 3 件を取り消しますか？この操作は元に戻せません。\nうち 2 件の未追跡ファイルはゴミ箱へ移動します。\nうち 1 件はフォルダ（git リポジトリ）で、フォルダとその中身がすべて移動します。'
    )
  })

  it('確認で拒否すると、ロックを取らず discardAll も呼ばない', async () => {
    const { result, options } = setup({ onConfirm: vi.fn().mockReturnValue(false) })
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
    expect(options.confirmDiscardAnyDirty).not.toHaveBeenCalled()
    expect(mockDiscardAll).not.toHaveBeenCalled()
  })

  it('変更が 0 件なら確認も出さず何もしない', async () => {
    const { result, options } = setup({ gitStatus: makeStatus([staged]) })
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(mockDiscardAll).not.toHaveBeenCalled()
  })

  it('承諾すると lockGlobal → discardAll(一覧) → unlockGlobal → 状態の再取得の順で行う', async () => {
    const order: string[] = []
    const fileLock = makeFileLock({
      lockGlobal: vi.fn(() => void order.push('lock')),
      unlockGlobal: vi.fn(() => void order.push('unlock'))
    })
    mockDiscardAll.mockImplementation(async () => {
      order.push('discard')
      return { status: 'done' }
    })
    const refreshGitStatus = vi.fn(async () => {
      order.push('refresh')
    })
    const { result } = setup({ fileLock, refreshGitStatus })
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(mockDiscardAll).toHaveBeenCalledWith([
      { path: 'a.ts', status: ' M' },
      { path: 'b.ts', status: ' D' },
      { path: 'c.ts', status: '??' }
    ])
    expect(order).toEqual(['lock', 'discard', 'refresh', 'unlock'])
  })

  it('失敗してもロックは解放され、error に入り、再読込しない', async () => {
    mockDiscardAll.mockRejectedValue(new Error('取り消せません'))
    const { result, options } = setup()
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledOnce()
    expect(result.current.error?.message).toBe('取り消せません')
    expect(options.reloadOpenFiles).not.toHaveBeenCalled()
    expect(options.refreshTree).not.toHaveBeenCalled()
    expect(result.current.isDiscarding).toBe(false)
  })

  it('confirmDiscardAnyDirty が拒否したら discardAll を呼ばず、ロックも取らない', async () => {
    const { result, options } = setup({ confirmDiscardAnyDirty: vi.fn().mockReturnValue(false) })
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(mockDiscardAll).not.toHaveBeenCalled()
    expect(options.fileLock.lockGlobal).not.toHaveBeenCalled()
  })

  it('成功すると全タブとツリーを再読込する。ツリーの再読込が reject しても例外にならない', async () => {
    mockDiscardAll.mockResolvedValue({ status: 'done' })
    const { result, options } = setup({ refreshTree: vi.fn().mockRejectedValue(new Error('ng')) })
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(options.refreshTree).toHaveBeenCalledOnce()
    expect(options.reloadOpenFiles).toHaveBeenCalledOnce()
    expect(result.current.error).toBeNull()
  })

  it('実行中は isDiscarding が true で、再度呼んでも discardAll は 1 回だけ', async () => {
    let resolveDiscard: () => void = () => {}
    mockDiscardAll.mockImplementation(
      () =>
        new Promise<DiscardAllResult>((resolve) => {
          resolveDiscard = () => resolve({ status: 'done' })
        })
    )
    const { result } = setup()
    let first: Promise<void> = Promise.resolve()
    let second: Promise<void> = Promise.resolve()
    act(() => {
      first = result.current.onDiscardAll()
    })
    expect(result.current.isDiscarding).toBe(true)
    act(() => {
      second = result.current.onDiscardAll()
    })
    await act(async () => {
      resolveDiscard()
      await Promise.all([first, second])
    })
    expect(mockDiscardAll).toHaveBeenCalledTimes(1)
    expect(result.current.isDiscarding).toBe(false)
  })

  it('他の操作がロック中なら、確認も出さずに何もしない', async () => {
    const fileLock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
    const { result, options } = setup({ fileLock })
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(mockDiscardAll).not.toHaveBeenCalled()
  })

  it('gitStatus が null(リポジトリ無し)なら、確認も出さずに何もしない', async () => {
    const { result, options } = setup({ gitStatus: null })
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(options.onConfirm).not.toHaveBeenCalled()
    expect(mockDiscardAll).not.toHaveBeenCalled()
  })

  it('失敗の次に成功した実行で error が消える', async () => {
    mockDiscardAll.mockRejectedValueOnce(new Error('ng')).mockResolvedValueOnce({ status: 'done' })
    const { result } = setup()
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(result.current.error).not.toBeNull()
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(result.current.error).toBeNull()
  })

  it('partial(一部だけ取り消し済み)は、成功扱いで全タブとツリーを再読込し、message を error に出す', async () => {
    const message = '一括の取り消しが途中で失敗しました（1 / 2 件を取り消し済み）: denied'
    mockDiscardAll.mockResolvedValue({ status: 'partial', message })
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    const { result, options } = setup({ refreshGitStatus })
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(result.current.error?.message).toBe(message)
    expect(options.reloadOpenFiles).toHaveBeenCalledOnce()
    expect(options.refreshTree).toHaveBeenCalledOnce()
    expect(refreshGitStatus).toHaveBeenCalledOnce()
    expect(options.fileLock.unlockGlobal).toHaveBeenCalledOnce()
    expect(result.current.isDiscarding).toBe(false)
  })

  it('partial の次に done の実行で error が消える', async () => {
    mockDiscardAll
      .mockResolvedValueOnce({ status: 'partial', message: '途中で失敗' })
      .mockResolvedValueOnce({ status: 'done' })
    const { result } = setup()
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(result.current.error?.message).toBe('途中で失敗')
    await act(async () => {
      await result.current.onDiscardAll()
    })
    expect(result.current.error).toBeNull()
  })
})
