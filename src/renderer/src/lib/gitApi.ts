import type { GitStatusResult } from '@shared/types'

export function getGitStatus(): Promise<GitStatusResult> {
  return window.api.getGitStatus()
}
