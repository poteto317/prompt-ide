import { renderHook, waitFor, act } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import type { GitLogEntry } from '@shared/types'
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
      Array.from({ length: 20 }, (_, i) => ({
        hash: String(i),
        message: 'm',
        date: 'd',
        authorName: 'x'
      }))
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
      Array.from({ length: 20 }, (_, i) => ({
        hash: `a${i}`,
        message: 'm',
        date: 'd',
        authorName: 'x'
      }))
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

  it('マウント時(フォルダ切替時)は isLoadingFolder が true になる', async () => {
    mockGetLog.mockResolvedValue([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    expect(result.current.isLoadingFolder).toBe(true)
    await waitFor(() => expect(result.current.isLoadingFolder).toBe(false))
  })

  it('同じフォルダ内の refresh(commit/amend 後の履歴再取得等)では isLoadingFolder は true にならない', async () => {
    // isLoadingFolder は CommitSection の amend チェック/メッセージ欄をリセットする
    // トリガーに使われる。refresh 中まで true にしてしまうと、amend 実行直後の
    // 履歴再取得(App.tsx の refreshHistory)によって、まだユーザーに見せている
    // はずの amend 実行結果(チェック状態・メッセージ)を同一フォルダ内なのに
    // 誤ってリセットしてしまう
    mockGetLog.mockResolvedValue([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.isLoadingFolder).toBe(false)
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
    mockGetLog.mockReturnValueOnce(firstFetchPromise)
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
      Array.from({ length: 20 }, (_, i) => ({
        hash: `a${i}`,
        message: 'm',
        date: 'd',
        authorName: 'x'
      }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // loadMore が完了するまで待たないで、すぐに2回目を呼ぶ
    let resolveLoadMore: (value: GitLogEntry[]) => void
    const loadMorePromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveLoadMore = resolve
    })
    mockGetLog.mockReturnValueOnce(loadMorePromise)

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

  it('loadMore 実行中に folderPath が変わった場合、古いフォルダの追加ページで新しいフォルダの log を汚染しない', async () => {
    mockGetLog.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        hash: `a${i}`,
        message: 'm',
        date: 'd',
        authorName: 'x'
      }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitHistory(path),
      {
        initialProps: { path: '/projectA' as string | null }
      }
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // loadMore(2ページ目) の解決を遅延させる
    let resolveLoadMore: (value: GitLogEntry[]) => void
    const loadMorePromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveLoadMore = resolve
    })
    mockGetLog.mockReturnValueOnce(loadMorePromise)
    void result.current.loadMore()
    await waitFor(() => expect(result.current.isLoading).toBe(true))

    // loadMore が完了する前に別フォルダへ切り替える
    const projectBLog = [{ hash: 'b1', message: 'commit B', date: 'd', authorName: 'y' }]
    mockGetLog.mockResolvedValueOnce(projectBLog)
    rerender({ path: '/projectB' })
    await waitFor(() => expect(result.current.log).toEqual(projectBLog))

    // 古いフォルダ(A)向けの loadMore ページが遅れて解決しても、
    // 現在表示中のフォルダ(B)の log を汚染してはいけない
    resolveLoadMore!([{ hash: 'stale', message: 'stale', date: 'd', authorName: 'x' }])
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.log).toEqual(projectBLog)
  })

  it('loadMore 実行中に folderPath が変わった場合、古いフォルダ向けの loadMore 完了で新しいフォルダの isLoading を誤って false に戻さない', async () => {
    mockGetLog.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        hash: `a${i}`,
        message: 'm',
        date: 'd',
        authorName: 'x'
      }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitHistory(path),
      { initialProps: { path: '/projectA' as string | null } }
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // loadMore(プロジェクトA向け)の解決を遅延させる
    let resolveLoadMore: (value: GitLogEntry[]) => void
    const loadMorePromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveLoadMore = resolve
    })
    mockGetLog.mockReturnValueOnce(loadMorePromise)
    void result.current.loadMore()
    await waitFor(() => expect(result.current.isLoading).toBe(true))

    // 別フォルダ(B)へ切り替える。Bのマウント fetch の解決も遅延させ、
    // isLoading が true のままであることを確認できるようにする
    let resolveProjectBFetch: (value: GitLogEntry[]) => void
    const projectBFetchPromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveProjectBFetch = resolve
    })
    mockGetLog.mockReturnValueOnce(projectBFetchPromise)
    rerender({ path: '/projectB' })

    // 古いフォルダ(A)向けの loadMore が(Bのfetchより先に)解決する
    resolveLoadMore!([{ hash: 'stale', message: 'stale', date: 'd', authorName: 'x' }])
    await new Promise((r) => setTimeout(r, 20))

    // Bのfetchがまだ進行中なので、isLoading は true のままのはず
    expect(result.current.isLoading).toBe(true)

    resolveProjectBFetch!([{ hash: 'b1', message: 'commit B', date: 'd', authorName: 'y' }])
    await waitFor(() => expect(result.current.isLoading).toBe(false))
  })

  it('同じフォルダ内で loadMore 実行中に refresh(コミット後の履歴再取得等)が割り込んだ場合、loadMore の結果を古い log に連結しない', async () => {
    // isLoading による多重実行防止は loadMore 同士の重複しか防げない。
    // refresh(commit/amend 成功後の refreshHistory 経由で呼ばれる)は isLoading を
    // 見ずに割り込んで実行されるため、loadMore が取得した「古いオフセットの
    // ページ」を、refresh が既に置き換えた新しい log に単純連結すると、
    // 新しいコミットを挟んでログが重複・欠落する
    mockGetLog.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        hash: `a${i}`,
        message: 'm',
        date: 'd',
        authorName: 'x'
      }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // loadMore(2ページ目)の解決を遅延させる
    let resolveLoadMore: (value: GitLogEntry[]) => void
    const loadMorePromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveLoadMore = resolve
    })
    mockGetLog.mockReturnValueOnce(loadMorePromise)
    let loadMorePromiseResult: Promise<void> = Promise.resolve()
    act(() => {
      loadMorePromiseResult = result.current.loadMore()
    })
    await waitFor(() => expect(mockGetLog).toHaveBeenCalledWith(20, 20))

    // loadMore がまだ未解決の間に、refresh(新しいコミットを含む先頭ページ)が割り込む
    const refreshedLog = [{ hash: 'new-commit', message: 'new', date: 'd', authorName: 'x' }]
    mockGetLog.mockResolvedValueOnce(refreshedLog)
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.log).toEqual(refreshedLog)

    // 遅れて loadMore の結果が解決しても、refresh が既に置き換えた log に
    // 古いオフセットのページを連結してはいけない
    await act(async () => {
      resolveLoadMore!(
        Array.from({ length: 20 }, (_, i) => ({
          hash: `a${20 + i}`,
          message: 'm',
          date: 'd',
          authorName: 'x'
        }))
      )
      await loadMorePromiseResult
    })
    expect(result.current.log).toEqual(refreshedLog)
  })

  it('loadMore 実行中に refresh が先に完了して isLoading が false に戻っても、loadMore 自体の多重実行防止は効き続ける', async () => {
    // isLoading は loadMore と refresh(fetchGitHistoryData 経由)の両方が
    // 共有する表示用の state。refresh が loadMore より先に完了すると
    // isLoading が false に戻り、ユーザーが「もっと見る」を連打できる状態に
    // 見えてしまう。isLoading だけで多重実行を防いでいると、この間に
    // loadMore を再度呼べてしまい、同じオフセットへの getLog が多重発行される
    mockGetLog.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        hash: `a${i}`,
        message: 'm',
        date: 'd',
        authorName: 'x'
      }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // loadMore(2ページ目)の解決を遅延させる
    let resolveLoadMore: (value: GitLogEntry[]) => void
    const loadMorePromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveLoadMore = resolve
    })
    mockGetLog.mockReturnValueOnce(loadMorePromise)
    act(() => {
      void result.current.loadMore()
    })
    await waitFor(() => expect(mockGetLog).toHaveBeenCalledWith(20, 20))
    expect(mockGetLog).toHaveBeenCalledTimes(2)

    // refresh が先に完了し、isLoading は false に戻る
    mockGetLog.mockResolvedValueOnce([
      { hash: 'new-commit', message: 'new', date: 'd', authorName: 'x' }
    ])
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.isLoading).toBe(false)

    // isLoading が false に戻った状態で、loadMore がまだ未解決のまま
    // 再度 loadMore を呼んでも、getLog は新たに発行されない
    await act(async () => {
      await result.current.loadMore()
    })
    expect(mockGetLog).toHaveBeenCalledTimes(3)

    // 先に発行しておいた loadMore を解決させ、後片付けする
    await act(async () => {
      resolveLoadMore!([])
    })
  })

  it('loadMore が既に表示済みのコミットを含むページを返しても、重複して連結しない', async () => {
    // オフセット方式のページングは、アプリ外(ターミナル等)でコミットが増えると
    // ずれる。20 件表示中に外部で 1 件コミットされると skip=20 は「既に表示済みの
    // 20 件目」を返し、同じコミットが二重表示されて HistorySection の
    // key={entry.hash} が重複する(アプリ内の refresh 割り込みは logRef で
    // 検知できるが、外部のコミットは検知できない)
    mockGetLog.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        hash: `a${i}`,
        message: 'm',
        date: 'd',
        authorName: 'x'
      }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // 外部コミットでページ境界がずれ、既出の a19 を含むページが返る
    mockGetLog.mockResolvedValueOnce([
      { hash: 'a19', message: 'm', date: 'd', authorName: 'x' },
      { hash: 'b0', message: 'm', date: 'd', authorName: 'x' }
    ])
    await act(async () => {
      await result.current.loadMore()
    })

    const hashes = result.current.log.map((e) => e.hash)
    expect(new Set(hashes).size).toBe(hashes.length)
    expect(hashes).toContain('b0')
  })

  it('取得ページが全件重複だった場合でも、次の loadMore は先へ進む(押しても何も起きない状態で固定されない)', async () => {
    // skip に log.length を使うと、アプリ外で PAGE_SIZE 件以上コミットされた後は
    // skip=20 が返す 20 件が全て既存ハッシュになり、appended 0 件・log.length 不変・
    // hasMore は true のまま。以降は何度押しても同じページを取り直すだけで
    // 前進しなくなる。skip は「取得済みページ数 × PAGE_SIZE」で管理する必要がある
    const firstPage = Array.from({ length: 20 }, (_, i) => ({
      hash: `a${i}`,
      message: 'm',
      date: 'd',
      authorName: 'x'
    }))
    mockGetLog.mockResolvedValueOnce(firstPage)
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // 1回目の loadMore: 全件が既に表示済み(外部コミットでページ境界がずれた)
    mockGetLog.mockResolvedValueOnce(firstPage)
    await act(async () => {
      await result.current.loadMore()
    })
    expect(mockGetLog).toHaveBeenLastCalledWith(20, 20)
    expect(result.current.log).toHaveLength(20)

    // 2回目の loadMore: skip が前進していないと同じ skip=20 を取り直して停滞する
    mockGetLog.mockResolvedValueOnce([{ hash: 'b0', message: 'm', date: 'd', authorName: 'x' }])
    await act(async () => {
      await result.current.loadMore()
    })
    expect(mockGetLog).toHaveBeenLastCalledWith(20, 40)
    expect(result.current.log.map((e) => e.hash)).toContain('b0')
  })

  it('同じフォルダ内で loadMore 実行中に refresh が割り込んだ場合、hasMore も古いページ長で上書きしない', async () => {
    // 上のテストで setLog は古い log への連結をスキップするよう修正済みだが、
    // setHasMore(nextPage.length === PAGE_SIZE) は log の stale チェックを経由せず
    // 無条件に実行されていたため、refresh 後の「今の log に続きがあるか」とは
    // 無関係な、古いオフセットで取得したページの件数で hasMore が上書きされて
    // しまっていた(「もっと見る」ボタンが誤って消える/残る)
    mockGetLog.mockResolvedValueOnce(
      Array.from({ length: 20 }, (_, i) => ({
        hash: `a${i}`,
        message: 'm',
        date: 'd',
        authorName: 'x'
      }))
    )
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.hasMore).toBe(true)

    let resolveLoadMore: (value: GitLogEntry[]) => void
    const loadMorePromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveLoadMore = resolve
    })
    mockGetLog.mockReturnValueOnce(loadMorePromise)
    let loadMorePromiseResult: Promise<void> = Promise.resolve()
    act(() => {
      loadMorePromiseResult = result.current.loadMore()
    })
    await waitFor(() => expect(mockGetLog).toHaveBeenCalledWith(20, 20))

    // refresh が割り込み、続きの無い短い先頭ページ(PAGE_SIZE 未満)に置き換える
    const refreshedLog = [{ hash: 'new-commit', message: 'new', date: 'd', authorName: 'x' }]
    mockGetLog.mockResolvedValueOnce(refreshedLog)
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.hasMore).toBe(false)

    // 遅れて loadMore が PAGE_SIZE ちょうどのページで解決しても、
    // refresh が確定させた hasMore=false を上書きしてはいけない
    await act(async () => {
      resolveLoadMore!(
        Array.from({ length: 20 }, (_, i) => ({
          hash: `a${20 + i}`,
          message: 'm',
          date: 'd',
          authorName: 'x'
        }))
      )
      await loadMorePromiseResult
    })
    expect(result.current.hasMore).toBe(false)
  })

  it('refresh 実行中に folderPath が変わった場合、古いフォルダの再取得結果で新しいフォルダの状態を上書きしない', async () => {
    mockGetLog.mockResolvedValueOnce([{ hash: 'a0', message: 'm', date: 'd', authorName: 'x' }])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result, rerender } = renderHook(
      ({ path }: { path: string | null }) => useGitHistory(path),
      { initialProps: { path: '/projectA' as string | null } }
    )
    await waitFor(() => expect(result.current.isLoading).toBe(false))

    // refresh(プロジェクトA向け)の解決を遅延させる
    let resolveRefresh: (value: GitLogEntry[]) => void
    const refreshPromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveRefresh = resolve
    })
    mockGetLog.mockReturnValueOnce(refreshPromise)
    const refreshCall = result.current.refresh()

    // refresh が完了する前に別フォルダへ切り替える(こちらのマウント fetch は先に完了する)
    const projectBLog = [{ hash: 'b1', message: 'commit B', date: 'd', authorName: 'y' }]
    mockGetLog.mockResolvedValueOnce(projectBLog)
    rerender({ path: '/projectB' })
    await waitFor(() => expect(result.current.log).toEqual(projectBLog))

    // 古いフォルダ(A)向けの refresh が遅れて解決しても、
    // 現在表示中のフォルダ(B)の log を汚染してはいけない
    resolveRefresh!([{ hash: 'stale', message: 'stale', date: 'd', authorName: 'x' }])
    await refreshCall
    await new Promise((r) => setTimeout(r, 20))
    expect(result.current.log).toEqual(projectBLog)
  })

  it('マウント時の初回取得が完了する前に refresh が先に完了した場合、マウント側の遅い結果で refresh 後の状態を上書きしない', async () => {
    // マウント時の load() は folderPath の変化(または unmount)しか cancelled を
    // 立てないため、同一 folderPath のまま refresh が先に割り込んで完了しても、
    // それを検知できない。コミット直後に refresh() を呼んだ場合、マウント時の
    // 初回取得(まだ実行中)が後から解決すると、refresh が反映したはずの
    // 最新の log を古いデータで上書きしてしまう
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])

    // 1回目の呼び出し(マウント時の初回取得)は未解決のまま保持する
    let resolveMountLoad: (value: GitLogEntry[]) => void
    const mountLoadPromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveMountLoad = resolve
    })
    mockGetLog.mockReturnValueOnce(mountLoadPromise)

    const { result } = renderHook(() => useGitHistory('/project'))
    expect(mockGetLog).toHaveBeenCalledTimes(1)

    // マウント時の取得がまだ解決していない間に、コミット後の refresh が実行され、
    // 先に解決する
    const freshLog = [{ hash: 'fresh', message: 'new commit', date: 'd', authorName: 'x' }]
    mockGetLog.mockResolvedValueOnce(freshLog)
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.log).toEqual(freshLog)

    // マウント時の初回取得(古いデータ)が今になって解決する
    resolveMountLoad!([{ hash: 'stale', message: 'old', date: 'd', authorName: 'x' }])
    await new Promise((r) => setTimeout(r, 20))

    // refresh が反映した最新の log が、後から解決したマウント側の
    // 古いデータで上書きされていないこと
    expect(result.current.log).toEqual(freshLog)
  })

  it('getLog が「コミット無し」以外の理由(git 未検出等)で失敗した場合、historyError にセットされる', async () => {
    // getLog 側は「コミット無し」以外のエラーを握りつぶさず伝播するよう修正済み。
    // ここで再び握りつぶすと、その修正が実質無効化され、ユーザーに実際の問題が
    // 伝わらない(履歴パネルが静かに空表示になるだけ)ままになってしまう
    mockGetLog.mockRejectedValue(new Error('spawn git ENOENT'))
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.historyError?.message).toBe('spawn git ENOENT')
  })

  it('別フォルダに切り替えた後 getLog が失敗した場合、historyError だけでなく log(lastCommitMessage の元)もクリアする', async () => {
    // catch で historyError だけをセットし log を前フォルダの値のまま残すと、
    // isLoadingLog が false に戻った時点で CommitSection の amend チェックボックスが
    // 「isCommitting=false, lastCommitMessage=前フォルダの非null値, isLoadingLog=false」
    // という条件を満たしてしまい、無関係な別リポジトリの直前コミットメッセージで
    // 誤って amend できてしまう
    mockGetLog.mockResolvedValueOnce([
      { hash: 'a', message: 'フォルダAの直前コミット', date: 'd', authorName: 'x' }
    ])
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result, rerender } = renderHook(({ folder }) => useGitHistory(folder), {
      initialProps: { folder: '/project-a' }
    })
    await waitFor(() => expect(result.current.log).toHaveLength(1))

    mockGetLog.mockRejectedValueOnce(new Error('spawn git ENOENT'))
    rerender({ folder: '/project-b' })

    await waitFor(() => expect(result.current.historyError).not.toBeNull())
    expect(result.current.log).toEqual([])
  })

  it('getLog の失敗後、再取得が成功すると historyError が null に戻る', async () => {
    mockGetLog.mockRejectedValueOnce(new Error('spawn git ENOENT'))
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])
    const { result } = renderHook(() => useGitHistory('/project'))
    await waitFor(() => expect(result.current.historyError).not.toBeNull())

    mockGetLog.mockResolvedValueOnce([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
    await result.current.refresh()
    await waitFor(() => expect(result.current.historyError).toBeNull())
    expect(result.current.log).toEqual([{ hash: 'a', message: 'm', date: 'd', authorName: 'x' }])
  })

  it('git 管理外のフォルダ(getBranches/getTags が throw する)では historyError をセットしない', async () => {
    // getBranches/getTags が not-a-repo で throw するのは正常系(isRepo 判定は
    // 別経路で行う)。ここまで historyError に載せると、通常の非gitフォルダでも
    // エラー扱いになってしまう。
    // getLog(main プロセス側の gitService.getLog)は checkIsRepo() で「リポジトリで
    // ない」ことを構造的に判定し、コミット無しと同様に空配列へフォールバックするよう
    // 修正済みのため、このモック(getLog は成功、getBranches/getTags のみ throw)は
    // 実際の simple-git の挙動と一致している(gitService.test.ts の
    // 「git 管理外のフォルダ(checkIsRepo が false)では raw を呼ばず空配列を返す」で
    // 検証済み)
    mockGetLog.mockResolvedValue([])
    mockGetBranches.mockRejectedValue(new Error('fatal: not a git repository'))
    mockGetTags.mockRejectedValue(new Error('fatal: not a git repository'))
    const { result } = renderHook(() => useGitHistory('/not-a-repo'))
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    expect(result.current.historyError).toBeNull()
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
    let resolveFetch: (value: GitLogEntry[]) => void
    const fetchPromise = new Promise<GitLogEntry[]>((resolve) => {
      resolveFetch = resolve
    })
    mockGetLog.mockReturnValueOnce(fetchPromise)
    mockGetBranches.mockResolvedValue([])
    mockGetTags.mockResolvedValue([])

    const { rerender, result } = renderHook(
      ({ path }: { path: string | null }) => useGitHistory(path),
      {
        initialProps: { path: '/project' as string | null }
      }
    )

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
