import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import type { GitStashEntry } from '@shared/types'
import type { PendingStashOperation, StashPanelState } from '../../types'
import type { FileOperationLock } from '../useFileOperationLock'

// 子フック(一覧の取得・操作)は静的な戻り値のモックに差し替え、useStashPanel の組み立てだけを検証する
const mockUseGitStashes = vi.hoisted(() =>
  vi.fn(() => ({
    stashes: [] as GitStashEntry[],
    refreshStashes: vi.fn()
  }))
)

const mockUseGitStashOperations = vi.hoisted(() =>
  vi.fn(
    (): {
      pendingStashOperation: PendingStashOperation | null
      pushStash: (message: string) => Promise<boolean>
      popStash: (sha: string) => Promise<boolean>
      dropStash: (entry: GitStashEntry) => Promise<boolean>
      stashOperationError: Error | null
    } => ({
      pendingStashOperation: null,
      pushStash: vi.fn().mockResolvedValue(true),
      popStash: vi.fn().mockResolvedValue(true),
      dropStash: vi.fn().mockResolvedValue(true),
      stashOperationError: null
    })
  )
)

vi.mock('../useGitStashes', () => ({ useGitStashes: mockUseGitStashes }))
vi.mock('../useGitStashOperations', () => ({
  useGitStashOperations: mockUseGitStashOperations
}))

import { useStashPanel } from '../useStashPanel'

const lock = {} as FileOperationLock

beforeEach(() => {
  vi.clearAllMocks()
  mockUseGitStashes.mockReturnValue({ stashes: [], refreshStashes: vi.fn() })
})

// 退避・復元は working tree を書き換える。未保存編集の破棄を確認し、成功時だけタブを再読込し、
// 未追跡ファイルが増減するためファイルツリーも読み直す(変更の取り消しと同じ理由)
const setup = (options: {
  confirmDiscardAnyDirty: () => boolean
  reloadOpenFiles: () => Promise<void>
  refreshTree: () => Promise<unknown>
  pushStash?: () => Promise<boolean>
  popStash?: () => Promise<boolean>
  dropStash?: (entry: GitStashEntry) => Promise<boolean>
}): ReturnType<typeof renderHook<StashPanelState, unknown>> => {
  mockUseGitStashOperations.mockReturnValue({
    pendingStashOperation: null,
    pushStash: options.pushStash ?? vi.fn().mockResolvedValue(true),
    popStash: options.popStash ?? vi.fn().mockResolvedValue(true),
    dropStash: options.dropStash ?? vi.fn().mockResolvedValue(true),
    stashOperationError: null
  })
  return renderHook(() =>
    useStashPanel({
      folderPath: '/project',
      gitStatus: null,
      refreshGitStatus: vi.fn().mockResolvedValue(undefined),
      fileOperationLock: lock,
      confirmDiscardAnyDirty: options.confirmDiscardAnyDirty,
      reloadOpenFiles: options.reloadOpenFiles,
      refreshTree: options.refreshTree
    })
  )
}

describe('useStashPanel', () => {
  it('子フックへ folderPath・gitStatus・ロック・一覧の再取得関数を渡す', () => {
    const refreshStashes = vi.fn()
    mockUseGitStashes.mockReturnValue({ stashes: [], refreshStashes })
    const refreshGitStatus = vi.fn().mockResolvedValue(undefined)
    renderHook(() =>
      useStashPanel({
        folderPath: '/project',
        gitStatus: null,
        refreshGitStatus,
        fileOperationLock: lock,
        confirmDiscardAnyDirty: () => true,
        reloadOpenFiles: vi.fn(),
        refreshTree: vi.fn()
      })
    )
    expect(mockUseGitStashes).toHaveBeenCalledWith('/project')
    expect(mockUseGitStashOperations).toHaveBeenCalledWith(
      null,
      refreshGitStatus,
      refreshStashes,
      lock
    )
  })

  it('退避: 未保存編集の確認 → 操作 → 成功時にファイルツリーとタブを再読込する', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const refreshTree = vi.fn().mockResolvedValue(true)
    const pushStash = vi.fn().mockResolvedValue(true)
    const { result } = setup({
      confirmDiscardAnyDirty: () => true,
      reloadOpenFiles,
      refreshTree,
      pushStash
    })
    await act(async () => {
      await result.current.onPush('msg')
    })
    expect(pushStash).toHaveBeenCalledWith('msg')
    expect(refreshTree).toHaveBeenCalledTimes(1)
    expect(reloadOpenFiles).toHaveBeenCalledTimes(1)
  })

  it('未保存編集の確認でキャンセルされたら、操作も再読込もしない', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const refreshTree = vi.fn().mockResolvedValue(true)
    const pushStash = vi.fn().mockResolvedValue(true)
    const { result } = setup({
      confirmDiscardAnyDirty: () => false,
      reloadOpenFiles,
      refreshTree,
      pushStash
    })
    await act(async () => {
      await result.current.onPush('msg')
    })
    expect(pushStash).not.toHaveBeenCalled()
    expect(refreshTree).not.toHaveBeenCalled()
    expect(reloadOpenFiles).not.toHaveBeenCalled()
  })

  // 失敗時に再読込すると、操作が行われていないのに無関係な未保存編集がディスク内容で上書きされる
  it('退避が失敗(false)したら、ファイルツリーもタブも再読込しない', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const refreshTree = vi.fn().mockResolvedValue(true)
    const { result } = setup({
      confirmDiscardAnyDirty: () => true,
      reloadOpenFiles,
      refreshTree,
      pushStash: vi.fn().mockResolvedValue(false)
    })
    await act(async () => {
      await result.current.onPush('msg')
    })
    expect(refreshTree).not.toHaveBeenCalled()
    expect(reloadOpenFiles).not.toHaveBeenCalled()
  })

  it('戻す: 成功時にファイルツリーとタブを再読込する', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const refreshTree = vi.fn().mockResolvedValue(true)
    const popStash = vi.fn().mockResolvedValue(true)
    const { result } = setup({
      confirmDiscardAnyDirty: () => true,
      reloadOpenFiles,
      refreshTree,
      popStash
    })
    await act(async () => {
      await result.current.onPop('a'.repeat(40))
    })
    expect(popStash).toHaveBeenCalledWith('a'.repeat(40))
    expect(refreshTree).toHaveBeenCalledTimes(1)
    expect(reloadOpenFiles).toHaveBeenCalledTimes(1)
  })

  // 事前検証の失敗(作業ツリーが汚い等)や巻き戻しに成功した apply 失敗ではディスクが変わらない。
  // ここで再読込すると、開いているタブの未保存編集が無関係に破棄される
  it('戻すが失敗(false)したら、ファイルツリーもタブも再読込しない(事前検証の失敗で未保存編集を守る)', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const refreshTree = vi.fn().mockResolvedValue(true)
    const popStash = vi.fn().mockResolvedValue(false)
    const { result } = setup({
      confirmDiscardAnyDirty: () => true,
      reloadOpenFiles,
      refreshTree,
      popStash
    })
    await act(async () => {
      await result.current.onPop('a'.repeat(40))
    })
    expect(popStash).toHaveBeenCalledTimes(1)
    expect(refreshTree).not.toHaveBeenCalled()
    expect(reloadOpenFiles).not.toHaveBeenCalled()
  })

  it('戻すでも、未保存編集の確認でキャンセルされたら何もしない', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const refreshTree = vi.fn().mockResolvedValue(true)
    const popStash = vi.fn().mockResolvedValue(false)
    const { result } = setup({
      confirmDiscardAnyDirty: () => false,
      reloadOpenFiles,
      refreshTree,
      popStash
    })
    await act(async () => {
      await result.current.onPop('a'.repeat(40))
    })
    expect(popStash).not.toHaveBeenCalled()
    expect(refreshTree).not.toHaveBeenCalled()
    expect(reloadOpenFiles).not.toHaveBeenCalled()
  })

  // ツリーの読み直しの失敗はツリー側が自身のエラー表示へ報告するため、タブの再読込を止めない
  it('ファイルツリーの読み直しが失敗しても、タブの再読込は行う', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const refreshTree = vi.fn().mockRejectedValue(new Error('read failed'))
    const { result } = setup({
      confirmDiscardAnyDirty: () => true,
      reloadOpenFiles,
      refreshTree
    })
    await act(async () => {
      await result.current.onPush('m')
    })
    expect(reloadOpenFiles).toHaveBeenCalledTimes(1)
  })

  // 削除は作業ツリーに触れないため、確認も再読込もラップせず操作をそのまま渡す
  it('削除は dropStash をそのまま使い、確認や再読込のラップをしない', async () => {
    const reloadOpenFiles = vi.fn().mockResolvedValue(undefined)
    const refreshTree = vi.fn().mockResolvedValue(true)
    const confirmDiscardAnyDirty = vi.fn(() => true)
    const dropStash = vi.fn().mockResolvedValue(true)
    const { result } = setup({ confirmDiscardAnyDirty, reloadOpenFiles, refreshTree, dropStash })
    expect(result.current.onDrop).toBe(dropStash)
    const entry: GitStashEntry = {
      sha: 'a'.repeat(40),
      message: 'm',
      branch: 'main',
      createdAt: '2026-10-01T10:00:00+09:00'
    }
    await act(async () => {
      await result.current.onDrop(entry)
    })
    expect(dropStash).toHaveBeenCalledWith(entry)
    expect(confirmDiscardAnyDirty).not.toHaveBeenCalled()
    expect(refreshTree).not.toHaveBeenCalled()
    expect(reloadOpenFiles).not.toHaveBeenCalled()
  })

  it('一覧・実行中の操作・エラーを子フックの値のまま反映する', () => {
    const entries: GitStashEntry[] = [
      { sha: 'a'.repeat(40), message: 'm', branch: 'main', createdAt: '2026-10-01T10:00:00+09:00' }
    ]
    mockUseGitStashes.mockReturnValue({ stashes: entries, refreshStashes: vi.fn() })
    mockUseGitStashOperations.mockReturnValue({
      pendingStashOperation: { kind: 'pop', sha: entries[0].sha },
      pushStash: vi.fn(),
      popStash: vi.fn(),
      dropStash: vi.fn(),
      stashOperationError: new Error('x')
    })
    const { result } = renderHook(() =>
      useStashPanel({
        folderPath: '/project',
        gitStatus: null,
        refreshGitStatus: vi.fn(),
        fileOperationLock: lock,
        confirmDiscardAnyDirty: () => true,
        reloadOpenFiles: vi.fn(),
        refreshTree: vi.fn()
      })
    )
    expect(result.current.entries).toBe(entries)
    expect(result.current.pendingOperation).toEqual({ kind: 'pop', sha: entries[0].sha })
    expect(result.current.error?.message).toBe('x')
  })
})
