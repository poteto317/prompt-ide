import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { FileTreeNode, OpenFile } from '../types'
import { detectLanguage } from '../lib/languageDetector'
import {
  isPathAtOrInside,
  isSafeEntryName,
  isSamePath,
  joinPath,
  replacePathPrefix
} from '../lib/pathUtils'
import * as fileSystemApi from '../lib/fileSystemApi'
import {
  SAVE_ABORTED_BY_CREATE,
  SAVE_ABORTED_BY_CREATE_DIRECTORY,
  SAVE_ABORTED_BY_DELETE_DIRECTORY,
  SAVE_ABORTED_BY_DELETE_FILE,
  SAVE_ABORTED_BY_RENAME_DESTINATION_DIRECTORY,
  SAVE_ABORTED_BY_RENAME_DESTINATION_FILE
} from './useFileEditing'
import type {
  FileOperationLockOptions,
  FileOperationResult,
  ResetForFileChangeOptions
} from './useFileEditing'

interface FileTreeOperationsOptions {
  /** 現在のフォルダを同期的に返す(クロージャの folderPath は切替後も古いままのため) */
  getFolderPath: () => string | null
  /** 呼び出し時点の openFiles を同期的に返す(操作中に確定した結果も見えるようにする) */
  getOpenFiles: () => OpenFile[]
  setOpenFiles: (updater: (prev: OpenFile[]) => OpenFile[]) => void
  resetForFileChange: (path: string, options?: ResetForFileChangeOptions) => void
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
    options?: FileOperationLockOptions
  ) => Promise<(result?: FileOperationResult) => void>
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
  getOpenFiles,
  setOpenFiles,
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

  const snapshotAffected = (node: FileTreeNode): OpenFile[] =>
    getOpenFiles().filter((f) => isPathAtOrInside(f.path, node.path))

  // 削除の待機中に入った未保存の編集を、確認なしで捨てない。影響を受ける
  // ファイルが複数ある場合、その集合の中に dirty なものが一つでもあれば
  // まとめて 1 回だけ確認する(ファイルごとに確認ダイアログを出すと煩雑なため)
  const confirmDiscardOfNewEdits = (
    node: FileTreeNode,
    affectedAtConfirm: OpenFile[],
    message: string = DISCARD_ON_DELETE_MESSAGE
  ): boolean => {
    const affectedNow = snapshotAffected(node)
    const hasDirty = affectedNow.some((f) => f.content !== f.savedContent)
    if (!hasDirty) return true
    // 待機中に確認済みの状態から変わっていなければ再確認しない(同じダイアログが2回出るのを防ぐ)
    const unchanged =
      affectedNow.length === affectedAtConfirm.length &&
      affectedNow.every((f) => {
        const before = affectedAtConfirm.find((b) => isSamePath(b.path, f.path))
        return (
          before !== undefined &&
          before.content === f.content &&
          before.savedContent === f.savedContent
        )
      })
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
    options?: FileOperationLockOptions
  ): Promise<void> => {
    const release = await lockPathForFileOperation(targetPath, options)
    // 操作が失敗したことを伝える。何も起きていないのに「上書きします」と
    // 案内したままにすると、ユーザーが保存を諦めて編集を失う
    let succeeded = false
    try {
      await operation()
      succeeded = true
    } finally {
      release({ succeeded })
    }
  }

  // 既存のエントリは壊さないので、配下の無関係な保存は待ってから書き込む。ただし
  // 作られるパス自体は無効にする。削除してバッファだけ残したファイルと同じ名前で
  // 作り直すと、待って書き込む扱いでは古いバッファで上書きする（ディレクトリの
  // 場合は EISDIR で失敗する）ため。
  // 区切りを含む名前や空の名前だと、joinPath が親ディレクトリ自身や別の階層を
  // 指してしまい、無関係な保存まで巻き込む。名前の検証は main 側が行うので、
  // ここでは「無効化の範囲を決めてよい名前か」だけを見る
  const createEntryLockOptions = (
    parentPath: string,
    name: string,
    abortMessage: string
  ): FileOperationLockOptions =>
    !isSafeEntryName(name)
      ? { invalidatesPaths: null }
      : { invalidatesPaths: [joinPath(parentPath, name)], abortMessage }

  const createFile = (parentPath: string, name: string): Promise<void> =>
    runFileOperation(() =>
      runLocked(
        parentPath,
        () => fileSystemApi.createFile(parentPath, name),
        createEntryLockOptions(parentPath, name, SAVE_ABORTED_BY_CREATE)
      ).then(() => true)
    )

  const createDirectory = (parentPath: string, name: string): Promise<void> =>
    runFileOperation(() =>
      runLocked(
        parentPath,
        () => fileSystemApi.createDirectory(parentPath, name),
        createEntryLockOptions(parentPath, name, SAVE_ABORTED_BY_CREATE_DIRECTORY)
      ).then(() => true)
    )

  const renameEntry = (node: FileTreeNode, newName: string): Promise<void> =>
    runFileOperation(async () => {
      // node.path は「親のプレフィックス + node.name」なので、末尾の name を差し替える
      const parentPrefix = node.path.slice(0, node.path.length - node.name.length)
      // joinPath は末尾の区切りを吸収してからつなぐため、区切り付きの
      // parentPrefix をそのまま渡しても二重区切りにならない
      const newPath = joinPath(parentPrefix, newName)
      // 保存中の書き込みがリネーム後に解決すると、旧パスが再作成される。
      // 操作の完了まで予約し、その間の新しい保存も開始させない。
      // 予約するのは元の path ではなく親ディレクトリ。移行先も同じ親の下に
      // 作られるため、元だけを予約すると移行先への作成・削除と並行に走り、
      // どちらが先に完了するかで結果が変わってしまう
      // 直列化は親ディレクトリ単位（移行先も同じ親の下に作られる）だが、
      // 無効になるのは元と先の 2 つだけ。同じフォルダの別ファイルの保存まで
      // 捨てると、Cmd+S が無反応に見えて内容が失われる。移行先を外すと、
      // 削除してバッファだけ残したファイルと同じ名前へリネームしてきた場合に、
      // 古いバッファでその内容を上書きしてしまう
      // lock 取得 → 操作 → 成否を伴う release は createFile/createDirectory と
      // 同じ形（runLocked が持つ「失敗を伝える」処理をここでも使う）
      await runLocked(parentPrefix, () => fileSystemApi.renameEntry(node.path, newName), {
        invalidatesPaths: [
          // 元: 待って書くと、リネームで消えた旧パスを作り直してしまう。文言は
          // 既定（SAVE_ABORTED_BY_FILE_OPERATION、「もう一度保存してください」）
          // のままでよい。開いているファイル自身のリネームなら、下の
          // resetForFileChange({ renamed }) がバッファを新パスへ追随させるため、
          // 実際に「もう一度保存」すれば新パスへ正しく書き込まれる
          { path: node.path },
          // 先: 待って書くと、リネームしてきた内容を古いバッファで上書きする。
          // ロックは完了で解放されるため、そのまま保存し直しても同じことが起きる。
          // 区切りを含む名前や空の名前だと、親ディレクトリ自身や別の階層を指して
          // 無関係な保存まで巻き込むため、その場合は元だけを無効にする
          ...(isSafeEntryName(newName)
            ? [
                {
                  path: newPath,
                  abortMessage:
                    node.type === 'directory'
                      ? SAVE_ABORTED_BY_RENAME_DESTINATION_DIRECTORY
                      : SAVE_ABORTED_BY_RENAME_DESTINATION_FILE
                }
              ]
            : [])
        ]
      })
      // 読み込み中のファイルがリネーム対象なら、旧 path のまま表示しないようにする。
      // await 中に始まった読み込みも拾えるよう、操作の成功後に呼ぶ
      invalidatePendingReads(node.path)
      // 開いているファイル自身、またはその祖先ディレクトリがリネームされた場合は
      // path が変わる。useFileEditing は「path が変わる経路は必ず
      // resetForFileChange(path) を伴う」ことを前提に savingPaths/generation を
      // 管理しているため、これに該当するのに呼ばないと保存中インジケータが
      // 旧pathのまま残ったり、保存完了時の savedContent 反映が旧path不一致で
      // スキップされたりする(deleteEntry の affected 判定と同じロジック)。
      // generation が path キーの Map になったことで、resetForFileChange の
      // 呼び出しはそのタブ自身の世代しか進めなくなった(他の開いているタブの
      // 保存には一切影響しない)ため、以前のようにアクティブなタブかどうかで
      // 呼び出しをゲートする必要はもう無い。非アクティブなタブのリネームでも
      // 素直に呼んでよい。
      // ここで進めるのはリネーム対象自身(node.path → newPath)の世代のみとする。
      // 祖先ディレクトリのリネームで付随的に path が変わる配下のファイルまで
      // 個別に世代を進めなくても安全なのは、それらの保存はリネーム自身が取得する
      // 親ディレクトリロック(runLocked の待機)によって、このリネームが実行される
      // 時点で既に完了しているため(ロックは対象配下の in-flight な保存すべてが
      // 終わるまで解放されない)。つまりリネームの瞬間に「巻き込まれる」進行中の
      // 保存は存在せず、世代を進めて守るべき対象は node.path 自身の識別子の
      // 切り替わりだけになる。
      let renamedOccurred = false
      setOpenFiles((prev) =>
        prev.map((f) => {
          if (!isPathAtOrInside(f.path, node.path)) return f
          renamedOccurred = true
          return isSamePath(f.path, node.path)
            ? // 開いているファイル自体のリネーム: 拡張子変更で language も変わり得る
              { ...f, path: newPath, name: newName, language: detectLanguage(newName) }
            : // 祖先ディレクトリのリネーム: プレフィックスを付け替える
              { ...f, path: replacePathPrefix(f.path, node.path, newPath) }
        })
      )
      if (renamedOccurred) {
        // 同じバッファが別の path で続く。このリネームが原因で中止した保存の
        // 通知を、ここで消してしまうと「保存されなかった」ことが伝わらない
        resetForFileChange(newPath, { renamed: { from: node.path, to: newPath } })
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
    const affectedAtConfirm = snapshotAffected(node)
    await runFileOperation(async () => {
      // 保存中の書き込みが削除後に解決すると、削除したファイルが復活する。
      // 操作の完了まで予約し、その間の新しい保存も開始させない
      const release = await lockPathForFileOperation(node.path, {
        abortMessage:
          node.type === 'directory' ? SAVE_ABORTED_BY_DELETE_DIRECTORY : SAVE_ABORTED_BY_DELETE_FILE
      })
      // 再確認から IPC の解決までの間もエディタは操作できる。ここでも
      // 開始時点の状態を控え、実行中に入った編集を確認なしで捨てない
      let affectedBeforeDelete: OpenFile[] = []
      let deleted = false
      try {
        if (!confirmDiscardOfNewEdits(node, affectedAtConfirm)) return false
        affectedBeforeDelete = snapshotAffected(node)
        await fileSystemApi.deleteEntry(node.path)
        deleted = true
      } finally {
        // 削除しなかった（確認で断った・失敗した）場合、それを理由に中止した
        // 保存の通知は取り下げる
        release({ succeeded: deleted })
      }
      // 読み込み中のファイルが削除対象なら、その結果を表示しないようにする。
      // await 中に始まった読み込みも拾えるよう、操作の成功後に呼ぶ
      invalidatePendingReads(node.path)
      // 削除の実行中に対象の読み込みが確定することがあるため、完了時点で判定する
      const affectedNow = snapshotAffected(node)
      if (affectedNow.length === 0) return true
      // 破棄を断った場合はバッファを残す。削除自体は完了しているため、
      // そのまま保存すればファイルを作り直せる
      if (confirmDiscardOfNewEdits(node, affectedBeforeDelete, DISCARD_AFTER_DELETE_MESSAGE)) {
        // generation が path キーの Map になったことで、resetForFileChange の
        // 呼び出しは対象タブ自身の世代しか進めなくなった(他の開いているタブの
        // 保存には一切影響しない)ため、削除されたのがアクティブなタブかどうかで
        // ゲートする必要はもう無い。影響を受けた全ファイル(ディレクトリ削除では
        // 複数あり得る)それぞれの世代を個別に進める
        setOpenFiles((prev) => prev.filter((f) => !isPathAtOrInside(f.path, node.path)))
        affectedNow.forEach((f) => resetForFileChange(f.path))
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
