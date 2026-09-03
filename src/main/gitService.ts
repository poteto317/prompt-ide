import simpleGit from 'simple-git'
import type { GitStatusResult } from '@shared/types'

export async function getGitStatus(folderPath: string): Promise<GitStatusResult> {
  const git = simpleGit(folderPath)
  const isRepo = await git.checkIsRepo()
  if (!isRepo) {
    return { isRepo: false, branch: null, ahead: 0, behind: 0, files: [] }
  }
  const status = await git.status()
  return {
    isRepo: true,
    branch: status.current,
    ahead: status.ahead,
    behind: status.behind,
    files: status.files.map((f) => ({
      path: f.path,
      index: f.index,
      workingDir: f.working_dir,
    })),
  }
}

export async function stageFile(folderPath: string, filePath: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.add(filePath)
}

export async function unstageFile(folderPath: string, filePath: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.reset(['--', filePath])
}

export async function commit(folderPath: string, message: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.commit(message)
}
