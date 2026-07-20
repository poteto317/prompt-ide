import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { FileTreeNode, OpenFile } from '../types'
import { detectLanguage } from '../lib/languageDetector'
import { isPathInside } from '../lib/pathUtils'
import * as fileSystemApi from '../lib/fileSystemApi'

interface FileTreeOperationsOptions {
  folderPath: string | null
  openFile: OpenFile | null
  setOpenFile: Dispatch<SetStateAction<OpenFile | null>>
  resetForFileChange: () => void
  onConfirm: (message: string) => boolean
}

interface FileTreeOperationsState {
  fileTree: FileTreeNode[]
  setFileTree: Dispatch<SetStateAction<FileTreeNode[]>>
  error: Error | null
  setError: Dispatch<SetStateAction<Error | null>>
  createFile: (parentPath: string, name: string) => Promise<void>
  createDirectory: (parentPath: string, name: string) => Promise<void>
  renameEntry: (node: FileTreeNode, newName: string) => Promise<void>
  deleteEntry: (node: FileTreeNode) => Promise<void>
}

// ファイル/フォルダの新規作成・リネーム・削除という CRUD 操作一式と、
// それに伴う「開いているファイルへの追随」(リネームでの path 付け替え、削除時のクローズ)を担う。
// フォルダ木の初回読み込み(openFolder/selectFile)は useFileSystem 側の責務のまま残す。
export function useFileTreeOperations({
  folderPath,
  openFile,
  setOpenFile,
  resetForFileChange,
  onConfirm
}: FileTreeOperationsOptions): FileTreeOperationsState {
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [error, setError] = useState<Error | null>(null)

  // fs:readDirectory はルートフォルダしか受け付けないため、ツリー更新はルートからの
  // 全再読込で行う(木は MAX_DEPTH=5 で小さく、部分更新の複雑さに見合わない)
  const refreshTree = async (): Promise<void> => {
    if (folderPath === null) return
    const tree = await fileSystemApi.readDirectory(folderPath)
    setFileTree(tree)
  }

  const runFileOperation = async (operation: () => Promise<void>): Promise<void> => {
    setError(null)
    try {
      await operation()
      await refreshTree()
    } catch (err) {
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const createFile = (parentPath: string, name: string): Promise<void> =>
    runFileOperation(() => fileSystemApi.createFile(parentPath, name))

  const createDirectory = (parentPath: string, name: string): Promise<void> =>
    runFileOperation(() => fileSystemApi.createDirectory(parentPath, name))

  const renameEntry = (node: FileTreeNode, newName: string): Promise<void> =>
    runFileOperation(async () => {
      await fileSystemApi.renameEntry(node.path, newName)
      // node.path は「親のプレフィックス + node.name」なので、末尾の name を差し替える
      const parentPrefix = node.path.slice(0, node.path.length - node.name.length)
      const newPath = parentPrefix + newName
      // 開いているファイル自身、またはその祖先ディレクトリがリネームされた場合は
      // openFile.path が変わる。useFileEditing は「path が変わる経路は必ず
      // resetForFileChange() を伴う」ことを前提に savingPaths/generation を
      // 管理しているため、ここで呼ばないと保存中インジケータが旧pathのまま
      // 残ったり、保存完了時の savedContent 反映が旧path不一致でスキップされたりする
      // (deleteEntry の affected 判定と同じロジック)。
      const affected =
        openFile !== null && (openFile.path === node.path || isPathInside(openFile.path, node.path))
      if (affected) {
        setOpenFile((prev) => {
          if (prev === null) return prev
          if (prev.path === node.path) {
            // 開いているファイル自体のリネーム: 拡張子変更で language も変わり得る
            return { ...prev, path: newPath, name: newName, language: detectLanguage(newName) }
          }
          // 開いているファイルの祖先ディレクトリのリネーム: プレフィックスを付け替える
          return { ...prev, path: newPath + prev.path.slice(node.path.length) }
        })
        resetForFileChange()
      }
    })

  const deleteEntry = async (node: FileTreeNode): Promise<void> => {
    const message =
      node.type === 'directory'
        ? `「${node.name}」を削除しますか？中身もすべて削除されます。`
        : `「${node.name}」を削除しますか？`
    if (!onConfirm(message)) return
    await runFileOperation(async () => {
      await fileSystemApi.deleteEntry(node.path)
      const affected =
        openFile !== null && (openFile.path === node.path || isPathInside(openFile.path, node.path))
      if (affected) {
        setOpenFile(null)
        resetForFileChange()
      }
    })
  }

  return { fileTree, setFileTree, error, setError, createFile, createDirectory, renameEntry, deleteEntry }
}
