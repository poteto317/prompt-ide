import { useState } from 'react'
import type { FileTreeNode, FileNode, OpenFile } from '../types'
import { createOpenFile } from '../lib/fileUtils'
import * as fileSystemApi from '../lib/fileSystemApi'

interface FileSystemState {
  folderPath: string | null
  fileTree: FileTreeNode[]
  openFile: OpenFile | null
  error: Error | null
  openFolder: () => Promise<void>
  selectFile: (node: FileTreeNode) => Promise<void>
}

export function useFileSystem(): FileSystemState {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [error, setError] = useState<Error | null>(null)

  const openFolder = async (): Promise<void> => {
    setError(null)
    try {
      const path = await fileSystemApi.openFolder()
      if (path === null) return
      const tree = await fileSystemApi.readDirectory(path)
      setFolderPath(path)
      setFileTree(tree)
      setOpenFile(null)
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const selectFile = async (node: FileTreeNode): Promise<void> => {
    if (node.type !== 'file') return
    // TypeScript resets property narrowing after `await`; capture the narrowed type here.
    const fileNode = node as FileNode
    setError(null)
    try {
      const content = await fileSystemApi.readFileContent(fileNode.path)
      setOpenFile(createOpenFile(fileNode, content))
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  return { folderPath, fileTree, openFile, error, openFolder, selectFile }
}
