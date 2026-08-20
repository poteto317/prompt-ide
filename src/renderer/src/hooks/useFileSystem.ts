import { useState } from 'react'
import type { FileTreeNode, FileNode, OpenFile } from '../types'
import { createOpenFile } from '../lib/fileUtils'
import * as fileSystemApi from '../lib/fileSystemApi'
import { useFileEditing } from './useFileEditing'
import type { Options } from './useFileEditing'
import { useFileTreeOperations } from './useFileTreeOperations'

interface FileSystemState {
  folderPath: string | null
  fileTree: FileTreeNode[]
  openFile: OpenFile | null
  isDirty: boolean
  isSaving: boolean
  error: Error | null
  saveError: Error | null
  openFolder: () => Promise<void>
  /** ファイルを開けたら true。ディレクトリ・破棄確認のキャンセル・読み込み失敗では false */
  selectFile: (node: FileTreeNode) => Promise<boolean>
  closeFile: () => void
  updateFileContent: (content: string) => void
  saveFile: () => Promise<void>
  createFile: (parentPath: string, name: string) => Promise<void>
  createDirectory: (parentPath: string, name: string) => Promise<void>
  renameEntry: (node: FileTreeNode, newName: string) => Promise<void>
  deleteEntry: (node: FileTreeNode) => Promise<void>
}

export function useFileSystem(options?: Options): FileSystemState {
  const [folderPath, setFolderPath] = useState<string | null>(null)
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  const onConfirm = options?.onConfirm ?? confirm

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

  // ファイル操作CRUD(作成/リネーム/削除)と、開いているファイルへの追随ロジックは
  // useFileTreeOperations に委譲する。fileTree/error の状態もそちらが保持する。
  const {
    fileTree,
    setFileTree,
    error,
    setError,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry
  } = useFileTreeOperations({ folderPath, openFile, setOpenFile, resetForFileChange, onConfirm })

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

  // 呼び出し側が「実際に開けたか」で分岐できるよう成否を返す。クイックオープンは
  // 開けなかったとき(破棄確認のキャンセルなど)にダイアログを閉じずに残す。
  const selectFile = async (node: FileTreeNode): Promise<boolean> => {
    if (node.type !== 'file') return false
    // TypeScript resets property narrowing after `await`; capture the narrowed type here.
    const fileNode = node as FileNode
    if (!confirmDiscardIfDirty()) return false
    setError(null)
    try {
      const content = await fileSystemApi.readFileContent(fileNode.path)
      setOpenFile(createOpenFile(fileNode, content))
      resetForFileChange()
      return true
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
      return false
    }
  }

  const closeFile = (): void => {
    if (!confirmDiscardIfDirty()) return
    setOpenFile(null)
    resetForFileChange()
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
    closeFile,
    updateFileContent,
    saveFile,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry
  }
}
