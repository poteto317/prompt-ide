import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { FileTreeNode, OpenFile } from '../types'
import { detectLanguage } from '../lib/languageDetector'
import { isPathAtOrInside, isSamePath } from '../lib/pathUtils'
import * as fileSystemApi from '../lib/fileSystemApi'
import type { FileOperationLockKind } from './useFileEditing'

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
  lockPathForFileOperation: (
    targetPath: string,
    kind?: FileOperationLockKind
  ) => Promise<() => void>
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
  /** ツリーを再読込する。実際に現在のツリーへ反映した場合のみ true */
  refreshTree: () => Promise<boolean>
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
  const refreshTree = async (): Promise<boolean> => {
    // フォルダ走査中は触らない。権威あるツリーはフォルダ読み込み側が書く
    const isLatestWrite = beginTreeWrite()
    if (isLatestWrite === null) return false
    // クロージャではなく「読み込む時点」のフォルダを見る。CRUD の完了が遅れると
    // クロージャの folderPath は切替前のものになり、旧フォルダを読んでしまう
    const target = getFolderPath()
    if (target === null) return false
    // 後発の読み込み(フォルダ読み込みを含む)が始まっていたら反映しない。
    // フォルダが同じでも、古いスナップショットで新しい結果を上書きしてしまう
    const isStale = (): boolean => !isLatestWrite() || getFolderPath() !== target
    try {
      const tree = await fileSystemApi.readDirectory(target)
      if (isStale()) return false
      setFileTree(tree)
      reportTreeLoad(null)
      return true
    } catch (err) {
      // 古い再読込の失敗を、現在の画面に出さない
      if (isStale()) return false
      reportTreeLoad(err instanceof Error ? err : new Error(String(err)))
      throw err
    }
  }

  const DISCARD_ON_DELETE_MESSAGE = '保存されていない変更があります。破棄して削除しますか？'
  // 削除は完了済みなので「削除しますか」ではなく破棄の可否だけを聞く。
  // 破棄しない場合はバッファを残すため、保存すればファイルを作り直せる
  const DISCARD_AFTER_DELETE_MESSAGE =
    'ファイルを削除しましたが、保存されていない変更があります。変更を破棄しますか？'

  // 削除の待機中に入った未保存の編集を、確認なしで捨てない
  const confirmDiscardOfNewEdits = (
    node: FileTreeNode,
    bufferAtConfirm: OpenFile | null,
    message: string = DISCARD_ON_DELETE_MESSAGE
  ): boolean => {
    const current = getOpenFile()
    if (current === null) return true
    // 正規化後に同一なら isPathInside は false を返すため、完全一致を含む判定を使う。
    // Windows では大文字小文字だけ違うパスも同じ実体を指す
    const affected = isPathAtOrInside(current.path, node.path)
    if (!affected) return true
    if (current.content === current.savedContent) return true
    const unchanged =
      bufferAtConfirm !== null &&
      bufferAtConfirm.path === current.path &&
      bufferAtConfirm.content === current.content &&
      bufferAtConfirm.savedContent === current.savedContent
    if (unchanged) return true
    return onConfirm(message)
  }

  /**
   * FS 操作を実行し、成功したらツリーを取り直す。
   * operation は「実際に実行したか」を返す。破棄確認のキャンセルなどで
   * 実行しなかった場合に再読込まで走らせると、削除していないのにその失敗が
   * エラー表示されたり、不要な更新で別の状態を上書きしたりするため。
   */
  // フォルダは未選択(null)になり得る。Windows では表記だけ違う同じフォルダも
  // あるため、生の比較だと開き直しただけで別フォルダと判定してしまう
  const isSameFolder = (a: string | null, b: string | null): boolean =>
    a === null || b === null ? a === b : isSamePath(a, b)

  const runFileOperation = async (operation: () => Promise<boolean>): Promise<void> => {
    setError(null)
    // 操作の開始時点のフォルダを控える。await 中にフォルダが切り替わってから
    // 失敗すると、旧フォルダのエラーが新しいフォルダの画面に表示されてしまう
    const folderAtStart = getFolderPath()
    try {
      const executed = await operation()
      if (!executed) return
      // 操作中にフォルダが切り替わっていたら取り直さない。旧フォルダで始まった
      // CRUD が新フォルダのツリーやエラーを更新してしまう
      if (!isSameFolder(getFolderPath(), folderAtStart)) return
      await refreshTree()
    } catch (err) {
      if (!isSameFolder(getFolderPath(), folderAtStart)) return
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // 作成も同じ mutex を通す。通さないと、作成先の祖先のリネーム・削除と
  // 並行して走り、FS の結果が実行順に依存する
  const runLocked = async (
    targetPath: string,
    operation: () => Promise<void>,
    kind: FileOperationLockKind = 'mutate'
  ): Promise<void> => {
    const release = await lockPathForFileOperation(targetPath, kind)
    try {
      await operation()
    } finally {
      release()
    }
  }

  const createFile = (parentPath: string, name: string): Promise<void> =>
    runFileOperation(() =>
      runLocked(parentPath, () => fileSystemApi.createFile(parentPath, name), 'create').then(
        () => true
      )
    )

  const createDirectory = (parentPath: string, name: string): Promise<void> =>
    runFileOperation(() =>
      runLocked(parentPath, () => fileSystemApi.createDirectory(parentPath, name), 'create').then(
        () => true
      )
    )

  const renameEntry = (node: FileTreeNode, newName: string): Promise<void> =>
    runFileOperation(async () => {
      // node.path は「親のプレフィックス + node.name」なので、末尾の name を差し替える
      const parentPrefix = node.path.slice(0, node.path.length - node.name.length)
      const newPath = parentPrefix + newName
      // 保存中の書き込みがリネーム後に解決すると、旧パスが再作成される。
      // 操作の完了まで予約し、その間の新しい保存も開始させない。
      // 予約するのは元の path ではなく親ディレクトリ。移行先も同じ親の下に
      // 作られるため、元だけを予約すると移行先への作成・削除と並行に走り、
      // どちらが先に完了するかで結果が変わってしまう
      const release = await lockPathForFileOperation(parentPrefix)
      try {
        await fileSystemApi.renameEntry(node.path, newName)
      } finally {
        release()
      }
      // 読み込み中のファイルがリネーム対象なら、旧 path のまま表示しないようにする。
      // await 中に始まった読み込みも拾えるよう、操作の成功後に呼ぶ
      invalidatePendingReads(node.path)
      // 開いているファイル自身、またはその祖先ディレクトリがリネームされた場合は
      // openFile.path が変わる。useFileEditing は「path が変わる経路は必ず
      // resetForFileChange() を伴う」ことを前提に savingPaths/generation を
      // 管理しているため、ここで呼ばないと保存中インジケータが旧pathのまま
      // 残ったり、保存完了時の savedContent 反映が旧path不一致でスキップされたりする
      // (deleteEntry の affected 判定と同じロジック)。
      // 操作の完了時点で判定する。開始時点のクロージャで見ると、操作中に
      // 確定した読み込み結果(その path が対象配下)を取りこぼす
      const current = getOpenFile()
      const affected = current !== null && isPathAtOrInside(current.path, node.path)
      if (affected) {
        setOpenFile(
          isSamePath(current.path, node.path)
            ? // 開いているファイル自体のリネーム: 拡張子変更で language も変わり得る
              { ...current, path: newPath, name: newName, language: detectLanguage(newName) }
            : // 祖先ディレクトリのリネーム: プレフィックスを付け替える
              { ...current, path: newPath + current.path.slice(node.path.length) }
        )
        resetForFileChange()
      }
      return true
    })

  const deleteEntry = async (node: FileTreeNode): Promise<void> => {
    const message =
      node.type === 'directory'
        ? `「${node.name}」を削除しますか？中身もすべて削除されます。`
        : `「${node.name}」を削除しますか？`
    if (!onConfirm(message)) return
    // 確認からロック取得までの間にも編集できる。待機中に入った変更を
    // 確認なしで捨てないよう、開始時点の状態を控えておく
    const bufferAtConfirm = getOpenFile()
    await runFileOperation(async () => {
      // 保存中の書き込みが削除後に解決すると、削除したファイルが復活する。
      // 操作の完了まで予約し、その間の新しい保存も開始させない
      const release = await lockPathForFileOperation(node.path)
      // 再確認から IPC の解決までの間もエディタは操作できる。ここでも
      // 開始時点の状態を控え、実行中に入った編集を確認なしで捨てない
      let bufferBeforeDelete: OpenFile | null = null
      try {
        if (!confirmDiscardOfNewEdits(node, bufferAtConfirm)) return false
        bufferBeforeDelete = getOpenFile()
        await fileSystemApi.deleteEntry(node.path)
      } finally {
        release()
      }
      // 読み込み中のファイルが削除対象なら、その結果を表示しないようにする。
      // await 中に始まった読み込みも拾えるよう、操作の成功後に呼ぶ
      invalidatePendingReads(node.path)
      // 削除の実行中に対象の読み込みが確定することがあるため、完了時点で判定する
      const current = getOpenFile()
      const affected = current !== null && isPathAtOrInside(current.path, node.path)
      if (affected) {
        // 破棄を断った場合はバッファを残す。削除自体は完了しているため、
        // そのまま保存すればファイルを作り直せる
        if (confirmDiscardOfNewEdits(node, bufferBeforeDelete, DISCARD_AFTER_DELETE_MESSAGE)) {
          setOpenFile(null)
          resetForFileChange()
        }
      }
      return true
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
