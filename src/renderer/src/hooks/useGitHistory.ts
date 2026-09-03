import { useCallback, useEffect, useState } from 'react'
import type { GitBranch, GitLogEntry } from '@shared/types'
import * as gitApi from '../lib/gitApi'

const PAGE_SIZE = 20

export interface GitHistoryState {
  log: GitLogEntry[]
  branches: GitBranch[]
  tags: string[]
  hasMore: boolean
  isLoading: boolean
  loadMore: () => Promise<void>
  refresh: () => Promise<void>
}

export function useGitHistory(folderPath: string | null): GitHistoryState {
  const [log, setLog] = useState<GitLogEntry[]>([])
  const [branches, setBranches] = useState<GitBranch[]>([])
  const [tags, setTags] = useState<string[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    let cancelled = false

    const fetchData = async (): Promise<void> => {
      if (folderPath === null) {
        setLog([])
        setBranches([])
        setTags([])
        setHasMore(false)
        return
      }
      setIsLoading(true)
      try {
        const [logResult, branchesResult, tagsResult] = await Promise.all([
          gitApi.getLog(PAGE_SIZE, 0),
          gitApi.getBranches(),
          gitApi.getTags()
        ])
        if (!cancelled) {
          setLog(logResult)
          setBranches(branchesResult)
          setTags(tagsResult)
          setHasMore(logResult.length === PAGE_SIZE)
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void fetchData()

    return () => {
      cancelled = true
    }
  }, [folderPath])

  const refresh = useCallback(async (): Promise<void> => {
    if (folderPath === null) return
    setIsLoading(true)
    try {
      const [logResult, branchesResult, tagsResult] = await Promise.all([
        gitApi.getLog(PAGE_SIZE, 0),
        gitApi.getBranches(),
        gitApi.getTags()
      ])
      setLog(logResult)
      setBranches(branchesResult)
      setTags(tagsResult)
      setHasMore(logResult.length === PAGE_SIZE)
    } finally {
      setIsLoading(false)
    }
  }, [folderPath])

  const loadMore = async (): Promise<void> => {
    if (folderPath === null || isLoading) return
    setIsLoading(true)
    try {
      const nextPage = await gitApi.getLog(PAGE_SIZE, log.length)
      setLog((prev) => [...prev, ...nextPage])
      setHasMore(nextPage.length === PAGE_SIZE)
    } finally {
      setIsLoading(false)
    }
  }

  return { log, branches, tags, hasMore, isLoading, loadMore, refresh }
}
