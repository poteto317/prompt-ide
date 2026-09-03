import { useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'

export interface GitOperationsState {
  stagingPaths: ReadonlySet<string>
  stageFile: (path: string) => Promise<void>
  unstageFile: (path: string) => Promise<void>
  isCommitting: boolean
  commit: (message: string) => Promise<boolean>
  amend: (message: string) => Promise<boolean>
  operationError: Error | null
}

export function useGitOperations(refreshGitStatus: () => Promise<void>): GitOperationsState {
  // useFileEditing.ts の savingPaths と同じパターン。即座に判定できる ref と、
  // 再レンダーを起こすための state を両方持つ
  const [stagingPaths, setStagingPaths] = useState<ReadonlySet<string>>(() => new Set())
  const stagingPathsRef = useRef<Set<string>>(new Set())
  const [isCommitting, setIsCommitting] = useState(false)
  const isCommittingRef = useRef(false)
  const [operationError, setOperationError] = useState<Error | null>(null)

  const runStageOperation = async (
    path: string,
    operation: (path: string) => Promise<void>
  ): Promise<void> => {
    if (stagingPathsRef.current.has(path)) return
    stagingPathsRef.current.add(path)
    setStagingPaths(new Set(stagingPathsRef.current))
    try {
      await operation(path)
      setOperationError(null)
    } catch (err) {
      setOperationError(err instanceof Error ? err : new Error(String(err)))
    } finally {
      stagingPathsRef.current.delete(path)
      setStagingPaths(new Set(stagingPathsRef.current))
      await refreshGitStatus()
    }
  }

  const stageFile = (path: string): Promise<void> => runStageOperation(path, gitApi.stageFile)
  const unstageFile = (path: string): Promise<void> => runStageOperation(path, gitApi.unstageFile)

  const commit = async (message: string): Promise<boolean> => {
    if (isCommittingRef.current) return false
    isCommittingRef.current = true
    setIsCommitting(true)
    try {
      await gitApi.commitChanges(message)
      setOperationError(null)
      return true
    } catch (err) {
      setOperationError(err instanceof Error ? err : new Error(String(err)))
      return false
    } finally {
      isCommittingRef.current = false
      setIsCommitting(false)
      await refreshGitStatus()
    }
  }

  const amend = async (message: string): Promise<boolean> => {
    if (isCommittingRef.current) return false
    isCommittingRef.current = true
    setIsCommitting(true)
    try {
      await gitApi.amendCommit(message)
      setOperationError(null)
      return true
    } catch (err) {
      setOperationError(err instanceof Error ? err : new Error(String(err)))
      return false
    } finally {
      isCommittingRef.current = false
      setIsCommitting(false)
      await refreshGitStatus()
    }
  }

  return { stagingPaths, stageFile, unstageFile, isCommitting, commit, amend, operationError }
}
