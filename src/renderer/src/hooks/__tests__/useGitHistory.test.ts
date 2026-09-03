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
})
