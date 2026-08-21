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
  /** ツリーへの書き込みを開始する。書き込めない場合は null */
  beginTreeWrite: () => (() => boolean) | null
  /** 指定パス配下を FS 操作中として予約する。解除関数を返す */
  lockPathForFileOperation: (targetPath: string) => Promise<() => void>
  /** ツリー読み込みの結果を通知する(失敗の案内に使う) */
  reportTreeLoad: (error: Error | null) => void
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
  refreshTree: () => Promise<void>
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
  invalidatePendingReads,
  beginTreeWrite,
  lockPathForFileOperation,
  reportTreeLoad
}: FileTreeOperationsOptions): FileTreeOperationsState {
  const [fileTree, setFileTree] = useState<FileTreeNode[]>([])
  const [error, setError] = useState<Error | null>(null)

  // fs:readDirectory はルートフォルダしか受け付けないため、ツリー更新はルートからの
  // 全再読込で行う(木は MAX_DEPTH=5 で小さく、部分更新の複雑さに見合わない)
  const refreshTree = async (): Promise<void> => {
    // フォルダ走査中は触らない。権威あるツリーはフォルダ読み込み側が書く
    const isLatestWrite = beginTreeWrite()
    if (isLatestWrite === null) return
    // クロージャではなく「読み込む時点」のフォルダを見る。CRUD の完了が遅れると
    // クロージャの folderPath は切替前のものになり、旧フォルダを読んでしまう
    const target = getFolderPath()
    if (target === null) return
    // 後発の読み込み(フォルダ読み込みを含む)が始まっていたら反映しない。
    // フォルダが同じでも、古いスナップショットで新しい結果を上書きしてしまう
    const isStale = (): boolean => !isLatestWrite() || getFolderPath() !== target
    try {
      const tree = await fileSystemApi.readDirectory(target)
      if (isStale()) return
      setFileTree(tree)
      reportTreeLoad(null)
    } catch (err) {
      // 古い再読込の失敗を、現在の画面に出さない
      if (isStale()) return
      reportTreeLoad(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  const runFileOperation = async (operation: () => Promise<void>): Promise<void> => {
    setError(null)
    // 操作の開始時点のフォルダを控える。await 中にフォルダが切り替わってから
    // 失敗すると、旧フォルダのエラーが新しいフォルダの画面に表示されてしまう
    const folderAtStart = getFolderPath()
    try {
      await operation()
      await refreshTree()
    } catch (err) {
      if (getFolderPath() !== folderAtStart) return
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  const createFile = (parentPath: string, name: string): Promise<void> =>
    runFileOperation(() => fileSystemApi.createFile(parentPath, name))

  const createDirectory = (parentPath: string, name: string): Promise<void> =>
    runFileOperation(() => fileSystemApi.createDirectory(parentPath, name))

  const renameEntry = (node: FileTreeNode, newName: string): Promise<void> =>
    runFileOperation(async () => {
      // 保存中の書き込みがリネーム後に解決すると、旧パスが再作成される。
      // 操作の完了まで予約し、その間の新しい保存も開始させない
      const release = await lockPathForFileOperation(node.path)
      try {
        await fileSystemApi.renameEntry(node.path, newName)
      } finally {
        release()
      }
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
      // 保存中の書き込みが削除後に解決すると、削除したファイルが復活する。
      // 操作の完了まで予約し、その間の新しい保存も開始させない
      const release = await lockPathForFileOperation(node.path)
      try {
        await fileSystemApi.deleteEntry(node.path)
      } finally {
        release()
      }
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
    deleteEntry,
    refreshTree
  }
}
