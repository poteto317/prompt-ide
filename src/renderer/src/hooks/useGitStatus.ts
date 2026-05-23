import { useState, useEffect, useCallback } from 'react'
import type { GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'

export function useGitStatus(folderPath: string | null) {
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState<Error | null>(null)

  const refreshGitStatus = useCallback(async (): Promise<void> => {
    if (folderPath === null) {
      setGitStatus(null)
      setGitLoading(false)
      setGitError(null)
      return
    }
    setGitLoading(true)
    setGitError(null)
    try {
      setGitStatus(await gitApi.getGitStatus())
    } catch (err) {
      setGitError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      setGitLoading(false)
    }
  }, [folderPath])

  useEffect(() => {
    refreshGitStatus()
  }, [refreshGitStatus])

  return { gitStatus, gitLoading, gitError, refreshGitStatus }
}
