import { useState, useEffect, useCallback, useRef } from 'react'
import type { GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'

export function useGitStatus(folderPath: string | null) {
  const [gitStatus, setGitStatus] = useState<GitStatusResult | null>(null)
  const [gitLoading, setGitLoading] = useState(false)
  const [gitError, setGitError] = useState<Error | null>(null)
  const latestRequestId = useRef(0)

  const refreshGitStatus = useCallback(async (): Promise<void> => {
    const requestId = ++latestRequestId.current
    if (folderPath === null) {
      setGitStatus(null)
      setGitLoading(false)
      setGitError(null)
      return
    }
    setGitLoading(true)
    setGitError(null)
    try {
      const result = await gitApi.getGitStatus()
      if (requestId === latestRequestId.current) {
        setGitStatus(result)
      }
    } catch (err) {
      if (requestId === latestRequestId.current) {
        setGitError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (requestId === latestRequestId.current) {
        setGitLoading(false)
      }
    }
  }, [folderPath])

  useEffect(() => {
    refreshGitStatus()
  }, [refreshGitStatus])

  return { gitStatus, gitLoading, gitError, refreshGitStatus }
}
