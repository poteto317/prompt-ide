import type {
  CloneRepositoryResult,
  ConflictChoice,
  ConflictFile,
  CreateTagRequest,
  DiscardAllEntry,
  DiscardAllResult,
  DeleteBranchResult,
  MergeBranchResult,
  GitStatusResult,
  GitLogEntry,
  GitBranch,
  GitPullResult,
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

export function discardAll(expected: DiscardAllEntry[]): Promise<DiscardAllResult> {
  return window.api.discardAll(expected)
}

export function getConflictFile(filePath: string): Promise<ConflictFile> {
  return window.api.getConflictFile(filePath)
}

export function resolveConflictBlocks(
  filePath: string,
  expectedDigests: string[],
  choices: Record<number, ConflictChoice>
): Promise<void> {
  return window.api.resolveConflictBlocks(filePath, expectedDigests, choices)
}

export function resolveConflictWholeFile(filePath: string, side: 'ours' | 'theirs'): Promise<void> {
  return window.api.resolveConflictWholeFile(filePath, side)
}

export function keepConflictFile(filePath: string): Promise<void> {
  return window.api.keepConflictFile(filePath)
}

export function removeConflictFile(filePath: string): Promise<void> {
  return window.api.removeConflictFile(filePath)
}

export function markConflictResolved(filePath: string): Promise<void> {
  return window.api.markConflictResolved(filePath)
}

export function completeMerge(): Promise<void> {
  return window.api.completeMerge()
}

export function abortMerge(): Promise<void> {
  return window.api.abortMerge()
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

export function getHeadCommitMessage(): Promise<string | null> {
  return window.api.getHeadCommitMessage()
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

export function pull(): Promise<GitPullResult> {
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

export function mergeBranch(branchName: string): Promise<MergeBranchResult> {
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

export function createTag(request: CreateTagRequest): Promise<void> {
  return window.api.createTag(request)
}

// Git 管理外のフォルダに空のリポジトリを作る(最初のブランチ名を渡す)
export function initRepository(branch: string): Promise<void> {
  return window.api.initRepository(branch)
}

// リモート origin を追加する(この時点では通信しない)
export function addOrigin(url: string): Promise<void> {
  return window.api.addOrigin(url)
}

// 現在のブランチを origin へ送り、upstream を設定する
export function pushSetUpstream(): Promise<void> {
  return window.api.pushSetUpstream()
}

// リポジトリを clone する(保存先の親フォルダは main が OS のダイアログで選ぶ)。成功したら main はそのフォルダを
// 開く許可に切り替えている(renderer は返ったパスを開く)
export function cloneRepository(url: string, folderName: string): Promise<CloneRepositoryResult> {
  return window.api.cloneRepository(url, folderName)
}

// 実行中の clone を中止する(実行中でなければ何もしない)
export function cancelCloneRepository(): Promise<void> {
  return window.api.cancelCloneRepository()
}
