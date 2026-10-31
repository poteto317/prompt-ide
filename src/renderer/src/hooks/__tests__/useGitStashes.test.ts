import { renderHook, act, waitFor } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStashEntry } from '@shared/types'

vi.mock('../../lib/gitApi')

import * as gitApi from '../../lib/gitApi'
import { useGitStashes } from '../useGitStashes'

const mockGetStashes = vi.mocked(gitApi.getStashes)
const entry = (sha: string): GitStashEntry => ({
  sha,
  message: 'm',
  branch: 'main',
  createdAt: '2026-10-01T10:00:00+09:00'
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useGitStashes', () => {
  it('フォルダを開いたら stash を取得する', async () => {
    mockGetStashes.mockResolvedValue([entry('a'.repeat(40))])
    const { result } = renderHook(() => useGitStashes('/project'))
    await waitFor(() => expect(result.current.stashes).toHaveLength(1))
  })

  it('フォルダが無ければ取得せず空', async () => {
    const { result } = renderHook(() => useGitStashes(null))
    expect(result.current.stashes).toEqual([])
    expect(mockGetStashes).not.toHaveBeenCalled()
  })

  // git 管理外のフォルダでは getStashes が失敗する。useGitHistory の getBranches と同じく
  // 空にフォールバックする(リポジトリかどうかは gitStatus が持つ)
  it('取得に失敗したら空にフォールバックする', async () => {
    mockGetStashes.mockRejectedValue(new Error('not a repo'))
    const { result } = renderHook(() => useGitStashes('/project'))
    await waitFor(() => expect(mockGetStashes).toHaveBeenCalled())
    expect(result.current.stashes).toEqual([])
  })

  it('refreshStashes で取り直す', async () => {
    mockGetStashes.mockResolvedValueOnce([])
    const { result } = renderHook(() => useGitStashes('/project'))
    await waitFor(() => expect(mockGetStashes).toHaveBeenCalledTimes(1))
    mockGetStashes.mockResolvedValueOnce([entry('b'.repeat(40))])
    await act(async () => {
      await result.current.refreshStashes()
    })
    expect(result.current.stashes.map((e) => e.sha)).toEqual(['b'.repeat(40)])
  })

  // フォルダを切り替えたあとに、前のフォルダの refresh が遅れて解決しても、古い結果で上書きしない
  it('フォルダを切り替えたあとに遅れて解決した古い refresh の結果で上書きしない', async () => {
    mockGetStashes.mockResolvedValue([])
    const { result, rerender } = renderHook(({ folder }) => useGitStashes(folder), {
      initialProps: { folder: '/a' as string | null }
    })
    await waitFor(() => expect(mockGetStashes).toHaveBeenCalledTimes(1))
    let resolveStale: (v: GitStashEntry[]) => void = () => {}
    mockGetStashes.mockReturnValueOnce(new Promise<GitStashEntry[]>((r) => (resolveStale = r)))
    let stale: Promise<void> = Promise.resolve()
    act(() => {
      stale = result.current.refreshStashes()
    })
    mockGetStashes.mockResolvedValue([entry('c'.repeat(40))])
    rerender({ folder: '/b' })
    await waitFor(() => expect(result.current.stashes).toHaveLength(1))
    await act(async () => {
      resolveStale([entry('d'.repeat(40))])
      await stale
    })
    expect(result.current.stashes.map((e) => e.sha)).toEqual(['c'.repeat(40)])
  })
})
