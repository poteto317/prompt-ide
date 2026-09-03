import type { GitStatusResult } from '@shared/types'

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
