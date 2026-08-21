import { useRef, useState } from 'react'
import { useLatestRef } from './useLatestRef'
import type { FileTreeNode, FileNode, OpenFile } from '../types'
import { createOpenFile } from '../lib/fileUtils'
import { isPathInside } from '../lib/pathUtils'
import * as fileSystemApi from '../lib/fileSystemApi'
import { useFileEditing } from './useFileEditing'
import type { Options } from './useFileEditing'
import { useFileTreeOperations } from './useFileTreeOperations'

export interface SelectFileOptions {
  /** 開いたあとエディタへフォーカスを移すか(クイックオープン経由の場合のみ true) */
  moveFocusToEditor?: boolean
}

interface FileSystemState {
  folderPath: string | null
  fileTree: FileTreeNode[]
  openFile: OpenFile | null
  /** ファイルを開くたびに増える。リネームによる path 変更と区別するために使う */
  openedFileSignal: number
  isDirty: boolean
  isSaving: boolean
  error: Error | null
  saveError: Error | null
  openFolder: () => Promise<void>
  /** ファイルを開けたら true。ディレクトリ・破棄確認のキャンセル・読み込み失敗では false */
  selectFile: (node: FileTreeNode, options?: SelectFileOptions) => Promise<boolean>
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
  // ファイル読み込みの世代。ファイル切替が読み込み完了より先に起きても、
  // 遅れて解決した古い読み込みが表示中のファイルやエラーを上書きしないようにする。
  // (エクスプローラーの連続クリックや、クイックオープンを閉じて開き直した場合に起きる)
  const latestReadRef = useRef(0)
  // ディレクトリ読み込みの世代。ファイル側と共有すると、読み込み中にタブを閉じたり
  // ファイルをクリックしたりするだけでフォルダ選択が黙って捨てられてしまう
  const latestDirectoryReadRef = useRef(0)
  // 実際に openFile をコミットした回数。「読み込みを開始したか」ではなく
  // 「選択が確定したか」で判定するために使う(失敗・キャンセルでは進まない)
  const committedOpenRef = useRef(0)
  // 進行中のファイル読み込みの対象パス。リネーム・削除の影響範囲だけを
  // 無効化するために使う(無関係な操作で有効な選択まで捨てないため)
  const pendingReadPathRef = useRef<string | null>(null)
  // openFile の同期ミラー。React の state はコミット後にしか読めないため、
  // 「操作の途中で確定した openFile」を同じ tick 内で参照するために持つ
  const openFileMirrorRef = useRef<OpenFile | null>(null)

  // openFile を更新する唯一の経路。ミラーを必ず同時に更新する
  const commitOpenFile = (next: OpenFile | null): void => {
    openFileMirrorRef.current = next
    setOpenFile(next)
  }
  const getOpenFile = (): OpenFile | null => openFileMirrorRef.current
  // ファイルを「開いた」ことを EditorPanel へ伝える信号。リネームでも
  // openFile.path は変わるため、path の変化だけでは open と区別できない
  const [openedFileSignal, setOpenedFileSignal] = useState(0)
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

  // 読み込みを待つ間に編集が入ることがある。開始時に取得した関数は当時の
  // isDirty を閉じ込めているため、コミット直前の再確認には最新のものを使う
  const confirmDiscardIfDirtyRef = useLatestRef(confirmDiscardIfDirty)
  // 待っている間に編集が入ったかを判定するため、最新の openFile を参照する
  const openFileRef = useLatestRef(openFile)

  /** 破棄確認の要否を判定するためのスナップショット(ファイルと内容の組) */
  type BufferSnapshot = { path: string | null; content: string | null }
  const snapshotBuffer = (): BufferSnapshot => ({
    path: openFileRef.current?.path ?? null,
    content: openFileRef.current?.content ?? null
  })

  // 待機の前後でバッファが変わっていたら、開始時の確認はその状態を見ていない。
  // 変わっていなければ再確認しない(同じダイアログが 2 回出てしまうため)。
  // 内容だけでなく path も見るのは、別ファイルへ切り替わって偶然同じ内容に
  // なった場合に「変化なし」と誤判定しないため
  const confirmDiscardIfChangedSince = (snapshot: BufferSnapshot): boolean => {
    const now = snapshotBuffer()
    if (now.path === snapshot.path && now.content === snapshot.content) return true
    return confirmDiscardIfDirtyRef.current()
  }

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
  } = useFileTreeOperations({
    folderPath,
    getOpenFile,
    setOpenFile: commitOpenFile,
    resetForFileChange,
    onConfirm,
    // リネーム・削除の対象が読み込み中のファイルなら、その結果を表示しないようにする。
    // (削除済みファイルを表示すると、編集して保存した時点で復活してしまう)
    // 影響範囲外の読み込みまで捨てると、無関係な操作で有効な選択を失う
    // ツリーの再読込も同じ世代で管理する。旧フォルダの refresh が新しい
    // フォルダ選択より後に解決すると、folderPath だけ新しくツリーが旧に戻る
    beginDirectoryRead: () => {
      const id = ++latestDirectoryReadRef.current
      return () => id === latestDirectoryReadRef.current
    },
    invalidatePendingReads: (affectedPath: string) => {
      const pending = pendingReadPathRef.current
      if (pending === null) return
      if (pending === affectedPath || isPathInside(pending, affectedPath)) {
        latestReadRef.current += 1
      }
    }
  })

  const openFolder = async (): Promise<void> => {
    if (!confirmDiscardIfDirty()) return
    setError(null)
    // 失敗した場合も、その時点で最新のフォルダ読み込みかを見てからエラーを出す
    let directoryReadId: number | null = null
    try {
      const path = await fileSystemApi.openFolder()
      if (path === null) return
      // フォルダを開き直すと openFile を null に戻すため、保留中の読み込みも無効化する
      directoryReadId = ++latestDirectoryReadRef.current
      // フォルダが変わるので、旧フォルダのファイルを読み込み中なら無効化する
      latestReadRef.current += 1
      const committedOpenAtStart = committedOpenRef.current
      const snapshot = snapshotBuffer()
      const tree = await fileSystemApi.readDirectory(path)
      // より新しいフォルダ選択が始まっていたら、こちらの結果は捨てる
      if (directoryReadId !== latestDirectoryReadRef.current) return
      // フォルダ選択そのものは必ず確定させる。ここを中断すると、読み込み中の
      // ファイル操作だけでフォルダ選択が黙って捨てられてしまう
      setFolderPath(path)
      setFileTree(tree)
      // 待つ間に「確定した」ファイル選択があれば、その結果を消さない。
      // 読み込みの開始ではなくコミット回数で見るのは、失敗・キャンセルした
      // 読み込みで旧フォルダのファイルが残ってしまうのを防ぐため
      if (committedOpenRef.current !== committedOpenAtStart) return
      // ディレクトリ走査は秒単位になり得る。その間に入った編集は開始時の確認が
      // 見ていないため、閉じる前にあらためて確認する。キャンセルされた場合は
      // フォルダとツリーだけ確定し、ファイルは開いたまま残す
      if (!confirmDiscardIfChangedSince(snapshot)) return
      // 走査中に始まってまだコミットしていない読み込みを無効化する。
      // 残すと、フォルダ確定後に解決して旧フォルダのファイルが表示される
      latestReadRef.current += 1
      commitOpenFile(null)
      resetForFileChange()
    } catch (err) {
      // 後発の操作が確定したあとに古い読み込みが失敗しても、現在の状態を汚さない
      if (directoryReadId !== null && directoryReadId !== latestDirectoryReadRef.current) return
      setError(err instanceof Error ? err : new Error(String(err)))
    }
  }

  // 呼び出し側が「実際に開けたか」で分岐できるよう成否を返す。クイックオープンは
  // 開けなかったとき(破棄確認のキャンセルなど)にダイアログを閉じずに残す。
  const selectFile = async (node: FileTreeNode, options?: SelectFileOptions): Promise<boolean> => {
    if (node.type !== 'file') return false
    // TypeScript resets property narrowing after `await`; capture the narrowed type here.
    const fileNode = node as FileNode
    if (!confirmDiscardIfDirty()) return false
    setError(null)
    const readId = ++latestReadRef.current
    pendingReadPathRef.current = fileNode.path
    const snapshot = snapshotBuffer()
    try {
      const content = await fileSystemApi.readFileContent(fileNode.path)
      // 待っている間に別のファイルへ切り替わっていたら、この結果は捨てる
      if (readId !== latestReadRef.current) return false
      if (!confirmDiscardIfChangedSince(snapshot)) return false
      commitOpenFile(createOpenFile(fileNode, content))
      resetForFileChange()
      committedOpenRef.current += 1
      // フォーカスをエディタへ移すかは呼び出し側が決める。エクスプローラーの
      // クリックで奪うと、ツリー内のキーボード移動位置が失われるため
      if (options?.moveFocusToEditor === true) setOpenedFileSignal((prev) => prev + 1)
      return true
    } catch (err) {
      if (readId !== latestReadRef.current) return false
      setError(err instanceof Error ? err : new Error(String(err)))
      return false
    } finally {
      if (readId === latestReadRef.current) pendingReadPathRef.current = null
    }
  }

  const closeFile = (): void => {
    if (!confirmDiscardIfDirty()) return
    // 閉じたあとに保留中の読み込みが解決してファイルが再表示されるのを防ぐ
    latestReadRef.current += 1
    commitOpenFile(null)
    resetForFileChange()
  }

  return {
    folderPath,
    fileTree,
    openFile,
    openedFileSignal,
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
