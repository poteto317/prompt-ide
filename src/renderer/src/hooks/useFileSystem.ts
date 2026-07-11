import { useState } from 'react'
import type { FileTreeNode, FileNode, OpenFile } from '../types'
import { createOpenFile } from '../lib/fileUtils'
import * as fileSystemApi from '../lib/fileSystemApi'
import { useFileEditing } from './useFileEditing'
import type { Options } from './useFileEditing'

interface FileSystemState {
  folderPath: string | null
  fileTree: FileTreeNode[]
  openFile: OpenFile | null
  isDirty: boolean
  isSaving: boolean
  error: Error | null
  saveError: Error | null
  openFolder: () => Promise<void>
  selectFile: (node: FileTreeNode) => Promise<void>
  updateFileContent: (content: string) => void
  saveFile: () => Promise<void>
}

export function useFileSystem(options?: Options): FileSystemState {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const [error, setError] = useState<Error | null>(null)

  // フォルダ/ファイル読み込み系のエラー(error)と保存系のエラー(saveError)を分離する。
  // 同一の error を Sidebar/EditorPanel 双方に渡すと、フォルダ読み込み失敗が
  // エディタ側に「保存失敗」として表示されるなど無関係なエラーが混線するため。
  const {
    isDirty,
    isSaving,
    saveError,
    updateFileContent,
    saveFile,
    resetForFileChange,
    confirmDiscardIfDirty
  } = useFileEditing(openFile, setOpenFile, options)

  const openFolder = async (): Promise<void> => {
    if (!confirmDiscardIfDirty()) return
    setError(null)
    try {
      const path = await fileSystemApi.openFolder()
      if (path === null) return
      const tree = await fileSystemApi.readDirectory(path)
      setFolderPath(path)
      setFileTree(tree)
      setOpenFile(null)
      resetForFileChange()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const selectFile = async (node: FileTreeNode): Promise<void> => {
    if (node.type !== 'file') return
    // TypeScript resets property narrowing after `await`; capture the narrowed type here.
    const fileNode = node as FileNode
    if (!confirmDiscardIfDirty()) return
    setError(null)
    try {
      const content = await fileSystemApi.readFileContent(fileNode.path)
      setOpenFile(createOpenFile(fileNode, content))
      resetForFileChange()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  return {
    folderPath,
    fileTree,
    openFile,
    isDirty,
    isSaving,
    error,
    saveError,
    openFolder,
    selectFile,
    updateFileContent,
    saveFile
  }
}
