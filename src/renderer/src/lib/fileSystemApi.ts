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

export function writeFileContent(path: string, content: string): Promise<void> {
  return window.api.writeFile(path, content)
}
