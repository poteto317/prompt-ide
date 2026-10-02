import { renderHook, act } from '@testing-library/react'
import type { RenderHookResult } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStashEntry, GitStatusResult, StashPopResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitStashOperations } from '../useGitStashOperations'
import type { GitStashOperationsState } from '../useGitStashOperations'
import type { FileOperationLock } from '../useFileOperationLock'

const mockPush = vi.mocked(gitApi.stashPush)
const mockPop = vi.mocked(gitApi.stashPop)
const mockDrop = vi.mocked(gitApi.stashDrop)

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
const entry: GitStashEntry = {
  sha: 'a'.repeat(40),
  message: 'fix bug',
  branch: 'main',
  createdAt: '2026-10-01T10:00:00+09:00'
}

const setup = (
  overrides: {
    status?: GitStatusResult | null
    lock?: FileOperationLock
    onConfirm?: (m: string) => boolean
    refreshStatus?: () => Promise<void>
    refreshStashes?: () => Promise<void>
  } = {}
): RenderHookResult<GitStashOperationsState, unknown> & {
  refreshStatus: () => Promise<void>
  refreshStashes: () => Promise<void>
  lock: FileOperationLock
} => {
  const refreshStatus = overrides.refreshStatus ?? vi.fn().mockResolvedValue(undefined)
  const refreshStashes = overrides.refreshStashes ?? vi.fn().mockResolvedValue(undefined)
  const lock = overrides.lock ?? makeFileLock()
  const hook = renderHook(() =>
    useGitStashOperations(
      overrides.status === undefined ? repoStatus : overrides.status,
      refreshStatus,
      refreshStashes,
      lock,
      { onConfirm: overrides.onConfirm ?? vi.fn().mockReturnValue(true) }
    )
  )
  return { ...hook, refreshStatus, refreshStashes, lock }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('pushStash', () => {
  it('stashPush をメッセージで呼び、成功したら true を返してステータスと一覧を再取得する', async () => {
    mockPush.mockResolvedValue(undefined)
    const { result, refreshStatus, refreshStashes } = setup()
    let ok = false
    await act(async () => {
      ok = await result.current.pushStash('msg')
    })
    expect(ok).toBe(true)
    expect(mockPush).toHaveBeenCalledWith('msg')
    expect(refreshStatus).toHaveBeenCalledOnce()
    expect(refreshStashes).toHaveBeenCalledOnce()
  })

  // 作業ツリーを書き換えるため lockGlobal を取る(実行中の push・ステージ・ブランチ操作を待たせる)
  it('実行中は lockGlobal を取り、完了後に unlockGlobal する', async () => {
    mockPush.mockResolvedValue(undefined)
    const { result, lock } = setup()
    await act(async () => {
      await result.current.pushStash('')
    })
    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })

  it('実行中は pendingStashOperation が { kind: push, sha: null }、完了後 null に戻る', async () => {
    let resolvePush: () => void = () => {}
    mockPush.mockReturnValue(new Promise<void>((r) => (resolvePush = r)))
    const { result } = setup()
    act(() => {
      void result.current.pushStash('m')
    })
    expect(result.current.pendingStashOperation).toEqual({ kind: 'push', sha: null })
    await act(async () => {
      resolvePush()
    })
    expect(result.current.pendingStashOperation).toBeNull()
  })

  it('失敗したら false を返し、stashOperationError に反映してロックを解除する', async () => {
    mockPush.mockRejectedValue(new Error('退避する変更がありません'))
    const { result, lock } = setup()
    let ok = true
    await act(async () => {
      ok = await result.current.pushStash('')
    })
    expect(ok).toBe(false)
    expect(result.current.stashOperationError?.message).toBe('退避する変更がありません')
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
  })
})

describe('popStash', () => {
  it('stashPop を SHA で呼び、実行中は { kind: pop, sha } になる', async () => {
    let resolvePop: (result: StashPopResult) => void = () => {}
    mockPop.mockReturnValue(new Promise<StashPopResult>((r) => (resolvePop = r)))
    const { result, lock } = setup()
    act(() => {
      void result.current.popStash(entry.sha)
    })
    expect(mockPop).toHaveBeenCalledWith(entry.sha)
    expect(result.current.pendingStashOperation).toEqual({ kind: 'pop', sha: entry.sha })
    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    await act(async () => {
      resolvePop({ status: 'restored' })
    })
  })
})

describe('popStash の結果とロック', () => {
  it('成功したら true を返し、ロックを解除してステータスと一覧を再取得する', async () => {
    mockPop.mockResolvedValue({ status: 'restored' })
    const { result, lock, refreshStatus, refreshStashes } = setup()
    let ok = false
    await act(async () => {
      ok = await result.current.popStash(entry.sha)
    })
    expect(ok).toBe(true)
    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
    expect(refreshStatus).toHaveBeenCalledOnce()
    expect(refreshStashes).toHaveBeenCalledOnce()
  })

  it.each([
    ['dropFailed', '退避は戻しましたが、一覧から削除できませんでした'],
    ['rollbackFailed', '退避を戻せず、元に戻す処理にも失敗しました']
  ] as const)(
    '%s は作業ツリーが変わっているので true を返し、message を stashOperationError に出して一覧を再取得する',
    async (status, message) => {
      mockPop.mockResolvedValue({ status, message })
      const { result, lock, refreshStatus, refreshStashes } = setup()
      let ok = false
      await act(async () => {
        ok = await result.current.popStash(entry.sha)
      })
      expect(ok).toBe(true)
      expect(result.current.stashOperationError?.message).toBe(message)
      expect(lock.unlockGlobal).toHaveBeenCalledOnce()
      expect(refreshStatus).toHaveBeenCalledOnce()
      expect(refreshStashes).toHaveBeenCalledOnce()
      expect(result.current.pendingStashOperation).toBeNull()
    }
  )

  it('警告つきの結果のあと、次の成功でエラーは消える', async () => {
    mockPop.mockResolvedValueOnce({ status: 'dropFailed', message: 'warn' })
    mockPop.mockResolvedValueOnce({ status: 'restored' })
    const { result } = setup()
    await act(async () => {
      await result.current.popStash(entry.sha)
    })
    expect(result.current.stashOperationError?.message).toBe('warn')
    await act(async () => {
      await result.current.popStash(entry.sha)
    })
    expect(result.current.stashOperationError).toBeNull()
  })

  it('reject したら false を返し、stashOperationError に反映してロックを解除する', async () => {
    mockPop.mockRejectedValue(new Error('戻せませんでした'))
    const { result, lock } = setup()
    let ok = true
    await act(async () => {
      ok = await result.current.popStash(entry.sha)
    })
    expect(ok).toBe(false)
    expect(result.current.stashOperationError?.message).toBe('戻せませんでした')
    expect(lock.lockGlobal).toHaveBeenCalledOnce()
    expect(lock.unlockGlobal).toHaveBeenCalledOnce()
    expect(result.current.pendingStashOperation).toBeNull()
  })
})

describe('dropStash', () => {
  it('確認でキャンセルしたら stashDrop を呼ばずに false を返す', async () => {
    const onConfirm = vi.fn().mockReturnValue(false)
    const { result } = setup({ onConfirm })
    let ok = true
    await act(async () => {
      ok = await result.current.dropStash(entry)
    })
    expect(ok).toBe(false)
    expect(onConfirm).toHaveBeenCalledWith('fix bug を捨てますか？この操作は元に戻せません。')
    expect(mockDrop).not.toHaveBeenCalled()
  })

  // 削除は作業ツリーに触れないため lockGlobal を取らない(取ると削除中に push/pull が無意味に待たされる)
  it('承諾されたら stashDrop を SHA で呼び、lockGlobal は取らない', async () => {
    mockDrop.mockResolvedValue(undefined)
    const { result, lock } = setup()
    let ok = false
    await act(async () => {
      ok = await result.current.dropStash(entry)
    })
    expect(ok).toBe(true)
    expect(mockDrop).toHaveBeenCalledWith(entry.sha)
    expect(lock.lockGlobal).not.toHaveBeenCalled()
  })
})

// 3 操作に共通の開始条件。ガード条件ごとに、他の条件が偶然真にならないモックで検証する(パターン 16)
describe('共通の開始条件', () => {
  const operations = {
    pushStash: (r: ReturnType<typeof setup>['result']) => r.current.pushStash('m'),
    popStash: (r: ReturnType<typeof setup>['result']) => r.current.popStash(entry.sha),
    dropStash: (r: ReturnType<typeof setup>['result']) => r.current.dropStash(entry)
  }
  const apiMock = { pushStash: () => mockPush, popStash: () => mockPop, dropStash: () => mockDrop }

  it.each(['pushStash', 'popStash', 'dropStash'] as const)(
    'リポジトリが無いとき %s は git API を呼ばずに false を返す',
    async (op) => {
      const { result } = setup({ status: null })
      let ok = true
      await act(async () => {
        ok = await operations[op](result)
      })
      expect(ok).toBe(false)
      expect(apiMock[op]()).not.toHaveBeenCalled()
    }
  )

  it.each(['pushStash', 'popStash', 'dropStash'] as const)(
    '他の操作が file lock を握っている間は %s を呼ばない',
    async (op) => {
      const lock = makeFileLock({ isAnyLocked: vi.fn().mockReturnValue(true) })
      const { result } = setup({ lock })
      let ok = true
      await act(async () => {
        ok = await operations[op](result)
      })
      expect(ok).toBe(false)
      expect(apiMock[op]()).not.toHaveBeenCalled()
    }
  )

  // 退避操作どうしは busy ref で排他にする(実行中に別の退避操作を始めない)
  it.each(['pushStash', 'popStash', 'dropStash'] as const)(
    '退避の実行中は %s を呼んでも git API を呼ばない',
    async (op) => {
      mockPush.mockReturnValue(new Promise<void>(() => {}))
      const { result } = setup()
      act(() => {
        void result.current.pushStash('busy')
      })
      mockPush.mockClear()
      await act(async () => {
        await operations[op](result)
      })
      expect(mockPush).not.toHaveBeenCalled()
      expect(mockPop).not.toHaveBeenCalled()
      expect(mockDrop).not.toHaveBeenCalled()
      expect(result.current.pendingStashOperation).toEqual({ kind: 'push', sha: null })
    }
  )
})
