import type { FileTreeNode } from '../types'

export function openFolder(): Promise<string | null> {
  return window.api.openFolder()
}

export function readDirectory(path: string): Promise<FileTreeNode[]> {
  return window.api.readDirectory(path)
}

export function readFileContent(path: string): Promise<string> {
  return window.api.readFile(path)
}
