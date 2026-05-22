import { join } from 'path'
import { readdir, readFile } from 'node:fs/promises'
import { shouldSkipDir, MAX_DEPTH, sortFileTree } from './traversalPolicy'

export type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

export function readFileContent(filePath: string): Promise<string> {
  return readFile(filePath, 'utf-8')
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
            children: await readDirRecursive(fullPath, depth + 1),
          }
        }
        return { name: e.name, path: fullPath, type: 'file' }
      })
  )
  return sortFileTree(nodes)
}
