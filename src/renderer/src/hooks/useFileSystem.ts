import { useRef, useState } from 'react'
import { useLatestRef } from './useLatestRef'
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
  /** ファイルを開くたびに増える。リネームによる path 変更と区別するために使う */
  openedFileSignal: number
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
  // ファイル読み込みの世代。ファイル切替が読み込み完了より先に起きても、
  // 遅れて解決した古い読み込みが表示中のファイルやエラーを上書きしないようにする。
  // (エクスプローラーの連続クリックや、クイックオープンを閉じて開き直した場合に起きる)
  const latestReadRef = useRef(0)
  // ディレクトリ読み込みの世代。ファイル側と共有すると、読み込み中にタブを閉じたり
  // ファイルをクリックしたりするだけでフォルダ選択が黙って捨てられてしまう
  const latestDirectoryReadRef = useRef(0)
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
    openFile,
    setOpenFile,
    resetForFileChange,
    onConfirm,
    // リネーム・削除の対象が読み込み中のファイルでも、その結果を表示しないようにする。
    // (削除済みファイルを表示すると、編集して保存した時点で復活してしまう)
    invalidatePendingReads: () => {
      latestReadRef.current += 1
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
      const fileReadIdAtStart = ++latestReadRef.current
      const tree = await fileSystemApi.readDirectory(path)
      // より新しいフォルダ選択が始まっていたら、こちらの結果は捨てる
      if (directoryReadId !== latestDirectoryReadRef.current) return
      setFolderPath(path)
      setFileTree(tree)
      // 待つ間に確定したファイル操作があれば、その結果を setOpenFile(null) で消さない。
      // フォルダ選択そのものは上で確定させるため、ここだけを条件付きにする
      if (fileReadIdAtStart === latestReadRef.current) {
        setOpenFile(null)
        resetForFileChange()
      }
    } catch (err) {
      // 後発の操作が確定したあとに古い読み込みが失敗しても、現在の状態を汚さない
      if (directoryReadId !== null && directoryReadId !== latestDirectoryReadRef.current) return
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
    const readId = ++latestReadRef.current
    try {
      const content = await fileSystemApi.readFileContent(fileNode.path)
      // 待っている間に別のファイルへ切り替わっていたら、この結果は捨てる
      if (readId !== latestReadRef.current) return false
      // 待っている間に編集が入っていた場合、開始時の確認はその編集を見ていない。
      // ここで置き換えると未保存の変更を確認なしに失うため、あらためて確認する
      if (!confirmDiscardIfDirtyRef.current()) return false
      setOpenFile(createOpenFile(fileNode, content))
      resetForFileChange()
      // リネームによる path 変更と区別できるよう、開いたときだけ信号を進める
      setOpenedFileSignal((prev) => prev + 1)
      return true
    } catch (err) {
      if (readId !== latestReadRef.current) return false
      setError(err instanceof Error ? err : new Error(String(err)))
      return false
    }
  }

  const closeFile = (): void => {
    if (!confirmDiscardIfDirty()) return
    // 閉じたあとに保留中の読み込みが解決してファイルが再表示されるのを防ぐ
    latestReadRef.current += 1
    setOpenFile(null)
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
