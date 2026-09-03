import { join } from 'path'
import { readdir, readFile, writeFile, mkdir, rename, rm, stat } from 'node:fs/promises'
import { shouldSkipDir, MAX_DEPTH, sortFileTree } from './traversalPolicy'
import { isEnoentError } from './fsErrors'
import type { FileTreeNode } from '@shared/types'

export type { FileTreeNode }

export function readFileContent(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8')
}

export function writeFileContent(filePath: string, content: string): Promise<void> {
  return writeFile(filePath, content, 'utf-8')
}

export async function createFile(filePath: string): Promise<void> {
  // flag 'wx' により既存ファイルを上書きせず EEXIST で失敗する
  await writeFile(filePath, '', { flag: 'wx' })
}

export async function createDirectory(dirPath: string): Promise<void> {
  // recursive なし: 親が存在しなければ ENOENT、既存なら EEXIST で失敗する
  await mkdir(dirPath)
}

export async function renameEntry(oldPath: string, newPath: string): Promise<void> {
  // POSIX の rename は既存ファイルを黙って上書きするため、事前に存在チェックして
  // EEXIST に変換する(チェックと rename の間の TOCTOU はローカル単一ユーザーの
  // デスクトップアプリでは許容範囲とする)。
  // ただし大文字小文字を区別しないFS(macOS APFS既定/Windows)では、大文字小文字のみ
  // 変更するリネーム(readme.md → README.md)で newPath の存在チェックが oldPath 自身に
  // ヒットする。同一エンティティ(dev+ino一致)は「別ファイルへの上書き」ではないため許可する。
  let exists = false
  try {
    const newStat = await stat(newPath)
    const oldStat = await stat(oldPath)
    exists = !(newStat.dev === oldStat.dev && newStat.ino === oldStat.ino)
  } catch (err) {
    // ENOENT(newPath または oldPath が存在しない)以外は握り潰さず伝播する。
    // EACCES 等で存在確認自体ができない場合まで「存在しない」と誤判定すると、
    // POSIX の rename が既存ファイルを黙って上書きしてしまう
    if (!isEnoentError(err)) throw err
  }
  if (exists) {
    const err: NodeJS.ErrnoException = new Error(
      `EEXIST: file already exists, rename '${oldPath}' -> '${newPath}'`
    )
    err.code = 'EEXIST'
    throw err
  }
  await rename(oldPath, newPath)
}

export async function deleteEntry(targetPath: string): Promise<void> {
  await rm(targetPath, { recursive: true })
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

export async function addToGitignore(folderPath: string, relativePath: string): Promise<void> {
  const gitignorePath = join(folderPath, '.gitignore')
  let existingContent = ''
  try {
    existingContent = await readFile(gitignorePath, 'utf-8')
  } catch (err) {
    if (!isEnoent(err)) throw err
  }
  const existingLines = existingContent.split('\n').map((line) => line.trim())
  if (existingLines.includes(relativePath)) return
  const needsNewline = existingContent.length > 0 && !existingContent.endsWith('\n')
  const newContent = existingContent + (needsNewline ? '\n' : '') + relativePath + '\n'
  await writeFile(gitignorePath, newContent, 'utf-8')
}

export async function readDirRecursive(dirPath: string, depth = 0): Promise<FileTreeNode[]> {
  if (depth > MAX_DEPTH) return []
  const entries = await readdir(dirPath, { withFileTypes: true })
  const nodes = await Promise.all(
    entries
      .filter((e) => !(e.isDirectory() && shouldSkipDir(e.name)))
      .map(async (e): Promise<FileTreeNode> => {
        const fullPath = join(dirPath, e.name)
        if (e.isDirectory()) {
          return {
            name: e.name,
            path: fullPath,
            type: 'directory',
            children: await readDirRecursive(fullPath, depth + 1)
          }
        }
        return { name: e.name, path: fullPath, type: 'file' }
      })
  )
  return sortFileTree(nodes)
}
