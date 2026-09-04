import { renderHook, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitHistory } from '../useGitHistory'

const mockGetLog = vi.mocked(gitApi.getLog)
const mockGetBranches = vi.mocked(gitApi.getBranches)
const mockGetTags = vi.mocked(gitApi.getTags)

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useGitHistory', () => {
  it('folderPath が設定されるとマウント時に log/branches/tags を取得する', async () => {
    mockGetLog.mockResolvedValue([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    mockGetBranches.mockResolvedValue([{ name: 'main', current: true }])
    mockGetTags.mockResolvedValue(['v1.0.0'])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(mockGetLog).toHaveBeenCalledWith(20, 0)
    expect(result.current.log).toEqual([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    expect(result.current.branches).toEqual([{ name: 'main', current: true }])
    expect(result.current.tags).toEqual(['v1.0.0'])
  })

  it('folderPath が null の場合は何も取得しない', () => {
    const { result } = renderHook(() => useGitHistory(null))
    expect(mockGetLog).not.toHaveBeenCalled()
    expect(result.current.log).toEqual([])
  })

  it('取得件数が20件ちょうどのとき hasMore は true になる', async () => {
    mockGetLog.mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => ({ hash: String(i), message: 'm', date: 'd', authorName: 'x' }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasMore).toBe(true)
  })

  it('取得件数が20件未満のとき hasMore は false になる', async () => {
    mockGetLog.mockResolvedValue([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasMore).toBe(false)
  })

  it('loadMore で次の20件を skip=20 で取得し、既存の log に連結する', async () => {
    mockGetLog.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({ hash: `a${i}`, message: 'm', date: 'd', authorName: 'x' }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    mockGetLog.mockResolvedValueOnce([{ hash: 'b0', message: 'm2', date: 'd2', authorName: 'y' }])
    await result.current.loadMore()
    await waitFor(() => expect(result.current.log).toHaveLength(21))
    expect(mockGetLog).toHaveBeenLastCalledWith(20, 20)
    expect(result.current.hasMore).toBe(false)
  })

  it('refresh で log/branches/tags を最初から再取得する', async () => {
    mockGetLog.mockResolvedValue([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    mockGetLog.mockClear()
    await result.current.refresh()
    expect(mockGetLog).toHaveBeenCalledWith(20, 0)
  })

  it('folderPath が素早く変更されたとき、古いフォルダの結果で状態が上書きされない', async () => {
    const projectALog = [{ hash: 'a1', message: 'commit A', date: 'd', authorName: 'x' }]
    const projectBLog = [
      { hash: 'b1', message: 'commit B1', date: 'd', authorName: 'y' },
      { hash: 'b2', message: 'commit B2', date: 'd', authorName: 'y' }
    ]

    // 最初のフェッチは遅延させておく
    let resolveFirstFetch: (value: typeof projectALog) => void
    const firstFetchPromise = new Promise<typeof projectALog>((resolve) => {
      resolveFirstFetch = resolve
    })
    mockGetLog.mockReturnValueOnce(firstFetchPromise as any)
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])

    const { rerender } = renderHook(({ path }) => useGitHistory(path), {
      initialProps: { path: '/projectA' }
    })

    // フォルダをBに変更（このフェッチは速く完了する）
    mockGetLog.mockResolvedValueOnce(projectBLog)
    rerender({ path: '/projectB' })
    await waitFor(() => expect(mockGetLog).toHaveBeenCalledWith(20, 0))

    // 古いフォルダAのフェッチが完了する
    resolveFirstFetch!(projectALog)

    // 最終的な状態はプロジェクトBの結果であるべき（Aで上書きされていない）
    await waitFor(() => {
      expect(mockGetLog).toHaveBeenCalledWith(20, 0)
    })
    // 最後のgetLog呼び出しがプロジェクトBのもの（2件）であることを確認
    const lastCallResult = await mockGetLog.mock.results[mockGetLog.mock.results.length - 1].value
    expect(lastCallResult).toHaveLength(2)
  })

  it('loadMore が実行中に再度呼ばれても、同じページを重複取得しない', async () => {
    mockGetLog.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({ hash: `a${i}`, message: 'm', date: 'd', authorName: 'x' }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // loadMore が完了するまで待たないで、すぐに2回目を呼ぶ
    let resolveLoadMore: (value: any) => void
    const loadMorePromise = new Promise((resolve) => {
      resolveLoadMore = resolve
    })
    mockGetLog.mockReturnValueOnce(loadMorePromise as any)

    // 最初のloadMore呼び出し
    const promise1 = result.current.loadMore()

    // isLoadingがtrueになるまで待つ
    await waitFor(() => expect(result.current.isLoading).toBe(true))

    // 2回目のloadMore呼び出し（guard により実行されるべきではない）
    const promise2 = result.current.loadMore()

    // 両方を完了させる
    resolveLoadMore!([{ hash: 'b0', message: 'm2', date: 'd2', authorName: 'y' }])
    await promise1
    await promise2

    // getLog は1回だけ呼ばれるべき（2回目のloadMoreはガード済みで呼ばれない）
    expect(mockGetLog).toHaveBeenCalledTimes(2) // 初期ロード1回 + loadMore1回
    expect(mockGetLog).toHaveBeenLastCalledWith(20, 20)
  })

  it('getBranches が reject しても unhandled rejection にならず、isLoading が false に戻る', async () => {
    // git 管理外のフォルダを開くと getBranches/getTags は throw するが、
    // fetchData に catch が無いと unhandled rejection になる
    mockGetLog.mockResolvedValue([])
    mockGetBranches.mockRejectedValue(new Error('fatal: not a git repository'))
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/not-a-repo'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.log).toEqual([])
  })

  it('refresh 中に getTags が reject しても unhandled rejection にならず、isLoading が false に戻る', async () => {
    mockGetLog.mockResolvedValue([])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    mockGetTags.mockRejectedValue(new Error('fatal: not a git repository'))
    await result.current.refresh()
    expect(result.current.isLoading).toBe(false)
  })

  it('folderPath が非null→null に遷移する際、fetch中でも isLoading は false に戻る', async () => {
    // fetch が遅延するように設定
    let resolveFetch: (value: any) => void
    const fetchPromise = new Promise((resolve) => {
      resolveFetch = resolve
    })
    mockGetLog.mockReturnValueOnce(fetchPromise as any)
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])

    const { rerender, result } = renderHook(({ path }: { path: string | null }) => useGitHistory(path), {
      initialProps: { path: '/project' as string | null }
    })

    // fetch が開始される（isLoading === true）
    await waitFor(() => {
      // getLog が呼ばれたことを確認
      expect(mockGetLog).toHaveBeenCalledWith(20, 0)
    })

    // fetch完了前に folderPath を null に変更
    rerender({ path: null })

    // この時点で isLoading は false になるべき
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // 古い fetch が後から完了しても、state は更新されない（canceled済み）
    resolveFetch!([{ hash: 'old', message: 'm', date: 'd', authorName: 'x' }])

    // isLoading は false のまま、log は空のまま
    expect(result.current.isLoading).toBe(false)
    expect(result.current.log).toEqual([])
  })
})
