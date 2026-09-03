import type { GitStatusResult, GitLogEntry, GitBranch } from '@shared/types'

export function getGitStatus(): Promise<GitStatusResult> {
  return window.api.getGitStatus()
}

export function stageFile(filePath: string): Promise<void> {
  return window.api.stageFile(filePath)
}

export function unstageFile(filePath: string): Promise<void> {
  return window.api.unstageFile(filePath)
}

export function commitChanges(message: string): Promise<void> {
  return window.api.commitChanges(message)
}

export function getDiff(filePath: string, staged: boolean): Promise<string> {
  return window.api.getDiff(filePath, staged)
}

export function stageHunk(filePath: string, patch: string): Promise<void> {
  return window.api.stageHunk(filePath, patch)
}

export function unstageHunk(filePath: string, patch: string): Promise<void> {
  return window.api.unstageHunk(filePath, patch)
}

export function getLog(limit: number, skip: number): Promise<GitLogEntry[]> {
  return window.api.getLog(limit, skip)
}

export function getBranches(): Promise<GitBranch[]> {
  return window.api.getBranches()
}

export function getTags(): Promise<string[]> {
  return window.api.getTags()
}

export function amendCommit(message: string): Promise<void> {
  return window.api.amendCommit(message)
}
