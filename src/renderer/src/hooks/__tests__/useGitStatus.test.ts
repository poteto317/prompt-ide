import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitStatus } from '../useGitStatus'

const mockGetGitStatus = vi.mocked(gitApi.getGitStatus)

const mockResult: GitStatusResult = {
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

describe('useGitStatus', () => {
  it('初期状態: gitStatus=null, gitLoading=false, gitError=null（folderPath=null）', () => {
    mockGetGitStatus.mockResolvedValue(mockResult)
    const { result } = renderHook(() => useGitStatus(null))
    expect(result.current.gitStatus).toBeNull()
    expect(result.current.gitLoading).toBe(false)
    expect(result.current.gitError).toBeNull()
  })

  it('folderPath が null のとき getGitStatus を呼ばない', async () => {
    const { result } = renderHook(() => useGitStatus(null))
    await act(async () => {})
    expect(mockGetGitStatus).not.toHaveBeenCalled()
    expect(result.current.gitStatus).toBeNull()
  })

  it('folderPath が設定されると自動で getGitStatus が呼ばれ gitStatus がセットされる', async () => {
    mockGetGitStatus.mockResolvedValue(mockResult)
    const { result } = renderHook(() => useGitStatus('/project'))
    await waitFor(() => expect(result.current.gitStatus).toEqual(mockResult))
    expect(mockGetGitStatus).toHaveBeenCalledOnce()
    expect(result.current.gitLoading).toBe(false)
    expect(result.current.gitError).toBeNull()
  })

  it('getGitStatus が throw したとき gitError にセットされ gitStatus は null のまま', async () => {
    mockGetGitStatus.mockRejectedValue(new Error('ipc error'))
    const { result } = renderHook(() => useGitStatus('/project'))
    await waitFor(() => expect(result.current.gitError).toBeInstanceOf(Error))
    expect(result.current.gitError?.message).toBe('ipc error')
    expect(result.current.gitStatus).toBeNull()
    expect(result.current.gitLoading).toBe(false)
  })

  it('refreshGitStatus を手動で呼ぶと再取得される', async () => {
    mockGetGitStatus.mockResolvedValue(mockResult)
    const { result } = renderHook(() => useGitStatus('/project'))
    await waitFor(() => expect(result.current.gitStatus).toEqual(mockResult))

    const updated: GitStatusResult = { ...mockResult, branch: 'feature/foo' }
    mockGetGitStatus.mockResolvedValue(updated)
    await act(async () => {
      await result.current.refreshGitStatus()
    })
    expect(result.current.gitStatus).toEqual(updated)
    expect(mockGetGitStatus).toHaveBeenCalledTimes(2)
  })

  it('folderPath が変わると再取得される', async () => {
    mockGetGitStatus.mockResolvedValue(mockResult)
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitStatus(path),
      { initialProps: { path: '/project-a' as string | null } }
    )
    await waitFor(() => expect(result.current.gitStatus).toEqual(mockResult))
    expect(mockGetGitStatus).toHaveBeenCalledTimes(1)

    const updated: GitStatusResult = { ...mockResult, branch: 'dev' }
    mockGetGitStatus.mockResolvedValue(updated)
    rerender({ path: '/project-b' })
    await waitFor(() => expect(result.current.gitStatus).toEqual(updated))
    expect(mockGetGitStatus).toHaveBeenCalledTimes(2)
  })

  it('別フォルダへ切り替えた時点で、新しい取得が終わる前に前フォルダの gitStatus をクリアする', async () => {
    // 残したままにすると、B の git status が返るまでの間、ソース管理パネルに
    // A のブランチ名とファイル一覧が「操作可能な状態で」表示される。その間に
    // 「+」を押すと、A のファイルパスが B の allowedFolder に対して解決され、
    // B 側の同名ファイルをステージしてしまう(無ければエラー)
    mockGetGitStatus.mockResolvedValue(mockResult)
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitStatus(path),
      { initialProps: { path: '/project-a' as string | null } }
    )
    await waitFor(() => expect(result.current.gitStatus).toEqual(mockResult))

    // B の取得は未解決のまま止める
    mockGetGitStatus.mockImplementation(() => new Promise<GitStatusResult>(() => {}))
    rerender({ path: '/project-b' })

    expect(result.current.gitStatus).toBeNull()
  })

  it('同じフォルダ内の再取得中は gitStatus を保持する(入力中のコミットメッセージを失わないため)', async () => {
    // フォルダ切替と違い、同一フォルダの再取得(stage/unstage/保存のたびに走る)で
    // クリアすると、SourceControlPanel が GitRepoView をアンマウントし、
    // CommitSection のローカル state(入力中のメッセージ)が破棄されてしまう
    mockGetGitStatus.mockResolvedValue(mockResult)
    const { result } = renderHook(() => useGitStatus('/project-a'))
    await waitFor(() => expect(result.current.gitStatus).toEqual(mockResult))

    mockGetGitStatus.mockImplementation(() => new Promise<GitStatusResult>(() => {}))
    act(() => {
      void result.current.refreshGitStatus()
    })

    expect(result.current.gitStatus).toEqual(mockResult)
  })

  it('folderPath が null に戻ると gitStatus / gitLoading / gitError が全てリセットされる', async () => {
    mockGetGitStatus.mockResolvedValue(mockResult)
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitStatus(path),
      { initialProps: { path: '/project' as string | null } }
    )
    await waitFor(() => expect(result.current.gitStatus).toEqual(mockResult))

    rerender({ path: null })
    await waitFor(() => expect(result.current.gitStatus).toBeNull())
    expect(result.current.gitLoading).toBe(false)
    expect(result.current.gitError).toBeNull()
  })

  it('エラー後に folderPath が null に戻ると gitError もリセットされる', async () => {
    mockGetGitStatus.mockRejectedValue(new Error('network error'))
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitStatus(path),
      { initialProps: { path: '/project' as string | null } }
    )
    await waitFor(() => expect(result.current.gitError).toBeInstanceOf(Error))

    rerender({ path: null })
    await waitFor(() => expect(result.current.gitError).toBeNull())
    expect(result.current.gitStatus).toBeNull()
    expect(result.current.gitLoading).toBe(false)
  })

  it('isRepo: false の結果もそのまま gitStatus にセットされる', async () => {
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
    mockGetGitStatus.mockResolvedValue(notRepo)
    const { result } = renderHook(() => useGitStatus('/not-a-repo'))
    await waitFor(() => expect(result.current.gitStatus).toEqual(notRepo))
  })

  it('リクエスト中に folderPath が変わると古いレスポンスは無視される（競合状態防止）', async () => {
    let resolveFirst!: (v: GitStatusResult) => void
    const firstResult: GitStatusResult = { ...mockResult, branch: 'old' }
    const secondResult: GitStatusResult = { ...mockResult, branch: 'new' }

    mockGetGitStatus
      .mockImplementationOnce(
        () =>
          new Promise<GitStatusResult>((resolve) => {
            resolveFirst = resolve
          })
      )
      .mockResolvedValueOnce(secondResult)

    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitStatus(path),
      { initialProps: { path: '/project-a' as string | null } }
    )

    // 1回目のリクエストが pending の間に folderPath を変更する
    rerender({ path: '/project-b' })

    // 2回目のリクエストが完了するのを待つ
    await waitFor(() => expect(result.current.gitStatus).toEqual(secondResult))

    // 1回目の古いレスポンスを遅れて返す
    resolveFirst(firstResult)
    await act(async () => {})

    // 古い結果で上書きされていないこと
    expect(result.current.gitStatus).toEqual(secondResult)
  })

  it('取得中は gitLoading が true になり、gitError を消す', async () => {
    mockGetGitStatus.mockRejectedValueOnce(new Error('first failure'))
    const { result } = renderHook(() => useGitStatus('/project'))
    await waitFor(() => expect(result.current.gitError).toBeInstanceOf(Error))

    mockGetGitStatus.mockImplementation(() => new Promise<GitStatusResult>(() => {}))
    act(() => {
      void result.current.refreshGitStatus()
    })

    expect(result.current.gitLoading).toBe(true)
    expect(result.current.gitError).toBeNull()
  })

  it('後から始まった取得があれば、古い取得の失敗は gitError に反映しない', async () => {
    let rejectFirst!: (err: Error) => void
    mockGetGitStatus
      .mockImplementationOnce(
        () =>
          new Promise<GitStatusResult>((_resolve, reject) => {
            rejectFirst = reject
          })
      )
      .mockResolvedValueOnce(mockResult)

    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitStatus(path),
      { initialProps: { path: '/project-a' as string | null } }
    )
    rerender({ path: '/project-b' })
    await waitFor(() => expect(result.current.gitStatus).toEqual(mockResult))

    await act(async () => {
      rejectFirst(new Error('stale failure'))
    })

    expect(result.current.gitError).toBeNull()
    expect(result.current.gitStatus).toEqual(mockResult)
  })

  it('古い取得が先に終わっても、新しい取得の読み込み中(gitLoading)を解除しない', async () => {
    let resolveFirst!: (v: GitStatusResult) => void
    mockGetGitStatus
      .mockImplementationOnce(
        () =>
          new Promise<GitStatusResult>((resolve) => {
            resolveFirst = resolve
          })
      )
      // 新しい取得は終わらないまま止める
      .mockImplementationOnce(() => new Promise<GitStatusResult>(() => {}))

    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitStatus(path),
      { initialProps: { path: '/project-a' as string | null } }
    )
    rerender({ path: '/project-b' })
    expect(result.current.gitLoading).toBe(true)

    await act(async () => {
      resolveFirst({ ...mockResult, branch: 'old' })
    })

    expect(result.current.gitLoading).toBe(true)
    expect(result.current.gitStatus).toBeNull()
  })
})
