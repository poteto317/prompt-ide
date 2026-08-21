import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { FileTreeNode, OpenFile } from '../types'
import { detectLanguage } from '../lib/languageDetector'
import { isPathInside } from '../lib/pathUtils'
import * as fileSystemApi from '../lib/fileSystemApi'

interface FileTreeOperationsOptions {
  /** 現在のフォルダを同期的に返す(クロージャの folderPath は切替後も古いままのため) */
  getFolderPath: () => string | null
  /** 呼び出し時点の openFile を同期的に返す(操作中に確定した結果も見えるようにする) */
  getOpenFile: () => OpenFile | null
  setOpenFile: (next: OpenFile | null) => void
  resetForFileChange: () => void
  onConfirm: (message: string) => boolean
  /**
   * 指定パス配下を対象とする保留中のファイル読み込みを無効化する。
   * FS 操作が成功したあとに呼ぶ(失敗時に有効な選択を失わないため)
   */
  invalidatePendingReads: (affectedPath: string) => void
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
  getFolderPath,
  getOpenFile,
  setOpenFile,
  resetForFileChange,
  onConfirm,
  invalidatePendingReads
}: FileTreeOperationsOptions): FileTreeOperationsState {
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [error, setError] = useState<Error | null>(null)

  // fs:readDirectory はルートフォルダしか受け付けないため、ツリー更新はルートからの
  // 全再読込で行う(木は MAX_DEPTH=5 で小さく、部分更新の複雑さに見合わない)
  const refreshTree = async (): Promise<void> => {
    // クロージャではなく「読み込む時点」のフォルダを見る。CRUD の完了が遅れると
    // クロージャの folderPath は切替前のものになり、旧フォルダを読んでしまう
    const target = getFolderPath()
    if (target === null) return
    try {
      const tree = await fileSystemApi.readDirectory(target)
      // 待っている間にフォルダが切り替わっていたら、その結果は反映しない
      if (getFolderPath() !== target) return
      setFileTree(tree)
    } catch (err) {
      // 古いフォルダの再読込の失敗を、新しいフォルダの画面に出さない
      if (getFolderPath() !== target) return
      throw err
    }
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
      // 読み込み中のファイルがリネーム対象なら、旧 path のまま表示しないようにする。
      // await 中に始まった読み込みも拾えるよう、操作の成功後に呼ぶ
      invalidatePendingReads(node.path)
      // node.path は「親のプレフィックス + node.name」なので、末尾の name を差し替える
      const parentPrefix = node.path.slice(0, node.path.length - node.name.length)
      const newPath = parentPrefix + newName
      // 開いているファイル自身、またはその祖先ディレクトリがリネームされた場合は
      // openFile.path が変わる。useFileEditing は「path が変わる経路は必ず
      // resetForFileChange() を伴う」ことを前提に savingPaths/generation を
      // 管理しているため、ここで呼ばないと保存中インジケータが旧pathのまま
      // 残ったり、保存完了時の savedContent 反映が旧path不一致でスキップされたりする
      // (deleteEntry の affected 判定と同じロジック)。
      // 操作の完了時点で判定する。開始時点のクロージャで見ると、操作中に
      // 確定した読み込み結果(その path が対象配下)を取りこぼす
      const current = getOpenFile()
      const affected =
        current !== null && (current.path === node.path || isPathInside(current.path, node.path))
      if (affected) {
        setOpenFile(
          current.path === node.path
            ? // 開いているファイル自体のリネーム: 拡張子変更で language も変わり得る
              { ...current, path: newPath, name: newName, language: detectLanguage(newName) }
            : // 祖先ディレクトリのリネーム: プレフィックスを付け替える
              { ...current, path: newPath + current.path.slice(node.path.length) }
        )
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
      // 読み込み中のファイルが削除対象なら、その結果を表示しないようにする。
      // await 中に始まった読み込みも拾えるよう、操作の成功後に呼ぶ
      invalidatePendingReads(node.path)
      // 削除の実行中に対象の読み込みが確定することがあるため、完了時点で判定する
      const current = getOpenFile()
      const affected =
        current !== null && (current.path === node.path || isPathInside(current.path, node.path))
      if (affected) {
        setOpenFile(null)
        resetForFileChange()
      }
    })
  }

  return {
    fileTree,
    setFileTree,
    error,
    setError,
    createFile,
    createDirectory,
    renameEntry,
    deleteEntry
  }
}
