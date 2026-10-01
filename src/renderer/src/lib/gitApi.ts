import type {
  DiscardAllResult,
  DeleteBranchResult,
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitStashEntry,
  StashPopResult
} from '@shared/types'

export function getGitStatus(): Promise<GitStatusResult> {
  return window.api.getGitStatus()
}

export function stageFile(filePath: string): Promise<void> {
  return window.api.stageFile(filePath)
}

export function unstageFile(filePath: string, renamedFrom?: string): Promise<void> {
  return window.api.unstageFile(filePath, renamedFrom)
}

export function discardChanges(filePath: string): Promise<void> {
  return window.api.discardChanges(filePath)
}

export function discardHunk(filePath: string, patch: string): Promise<void> {
  return window.api.discardHunk(filePath, patch)
}

export function discardAll(expectedCount: number): Promise<DiscardAllResult> {
  return window.api.discardAll(expectedCount)
}

export function commitChanges(message: string): Promise<void> {
  return window.api.commitChanges(message)
}

export function getDiff(
  filePath: string,
  staged: boolean,
  isUntracked: boolean,
  renamedFrom?: string
): Promise<string> {
  return window.api.getDiff(filePath, staged, isUntracked, renamedFrom)
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

export function push(): Promise<void> {
  return window.api.push()
}

export function pull(): Promise<void> {
  return window.api.pull()
}

export function fetchRemote(): Promise<void> {
  return window.api.fetchRemote()
}

export function checkoutBranch(branchName: string): Promise<void> {
  return window.api.checkoutBranch(branchName)
}

export function createBranch(branchName: string): Promise<void> {
  return window.api.createBranch(branchName)
}

export function deleteBranch(branchName: string, force: boolean): Promise<DeleteBranchResult> {
  return window.api.deleteBranch(branchName, force)
}

export function mergeBranch(branchName: string): Promise<void> {
  return window.api.mergeBranch(branchName)
}

export function getStashes(): Promise<GitStashEntry[]> {
  return window.api.getStashes()
}

export function stashPush(message: string): Promise<void> {
  return window.api.stashPush(message)
}

export function stashPop(sha: string): Promise<StashPopResult> {
  return window.api.stashPop(sha)
}

export function stashDrop(sha: string): Promise<void> {
  return window.api.stashDrop(sha)
}
