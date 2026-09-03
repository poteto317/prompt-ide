import { spawn } from 'node:child_process'
import { join } from 'path'
import { readFile } from 'node:fs/promises'
import simpleGit from 'simple-git'
import type { GitStatusResult, GitLogEntry, GitBranch } from '@shared/types'

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

function buildUntrackedDiff(filePath: string, content: string): string {
  const lines = content.split('\n')
  // 末尾の空行は split の仕様上、実ファイルに無い余分な要素になるため取り除く
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  const addedLines = lines.map((line) => `+${line}`).join('\n')
  return (
    `diff --git a/${filePath} b/${filePath}\n` +
    `new file mode 100644\n` +
    `--- /dev/null\n` +
    `+++ b/${filePath}\n` +
    `@@ -0,0 +1,${lines.length} @@\n` +
    `${addedLines}\n`
  )
}

export async function getDiff(
  folderPath: string,
  filePath: string,
  staged: boolean
): Promise<string> {
  const git = simpleGit(folderPath)
  if (!staged) {
    const status = await git.status()
    const file = status.files.find((f) => f.path === filePath)
    if (file !== undefined && file.index === '?') {
      const content = await readFile(join(folderPath, filePath), 'utf-8')
      return buildUntrackedDiff(filePath, content)
    }
  }
  const args = staged ? ['--cached', '-U3', '--', filePath] : ['-U3', '--', filePath]
  return git.diff(args)
}

function runGitApply(cwd: string, filePath: string, args: string[], input: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn('git', args, { cwd })
    let stderr = ''
    proc.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })
    proc.on('error', reject)
    proc.on('close', (code: number) => {
      if (code === 0) {
        resolvePromise()
      } else {
        reject(new Error(`git apply failed for ${filePath}: ${stderr.trim()}`))
      }
    })
    proc.stdin.write(input)
    proc.stdin.end()
  })
}

export async function stageHunk(folderPath: string, filePath: string, patch: string): Promise<void> {
  await runGitApply(folderPath, filePath, ['apply', '--cached', '--whitespace=nowarn', '-'], patch)
}

export async function unstageHunk(folderPath: string, filePath: string, patch: string): Promise<void> {
  await runGitApply(
    folderPath,
    filePath,
    ['apply', '--cached', '--reverse', '--whitespace=nowarn', '-'],
    patch
  )
}

export async function getLog(folderPath: string, limit: number, skip: number): Promise<GitLogEntry[]> {
  const git = simpleGit(folderPath)
  const format = '%H%x1f%s%x1f%aI%x1f%an%x1e'
  let output: string
  try {
    output = await git.raw(['log', `--max-count=${limit}`, `--skip=${skip}`, `--pretty=format:${format}`])
  } catch {
    return []
  }
  return output
    .split('\x1e')
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [hash, message, date, authorName] = record.split('\x1f')
      return { hash, message, date, authorName }
    })
}

export async function getBranches(folderPath: string): Promise<GitBranch[]> {
  const git = simpleGit(folderPath)
  const summary = await git.branchLocal()
  return summary.all.map((name) => ({ name, current: name === summary.current }))
}

export async function getTags(folderPath: string): Promise<string[]> {
  const git = simpleGit(folderPath)
  const result = await git.tags()
  return result.all
}

export async function amendCommit(folderPath: string, message: string): Promise<void> {
  const git = simpleGit(folderPath)
  await git.commit(message, ['--amend'])
}
