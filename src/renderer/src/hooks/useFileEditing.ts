import { useState, type Dispatch, type SetStateAction } from 'react'
import type { OpenFile } from '../types'
import * as fileSystemApi from '../lib/fileSystemApi'
import { useLatestRef } from './useLatestRef'

const DISCARD_CONFIRM_MESSAGE = '保存されていない変更があります。破棄して続行しますか？'

export interface Options {
  onConfirm?: (message: string) => boolean
}

interface FileEditingState {
  isDirty: boolean
  isSaving: boolean
  saveError: Error | null
  updateFileContent: (content: string) => void
  saveFile: () => Promise<void>
  confirmDiscardIfDirty: () => boolean
}

export function useFileEditing(
  openFile: OpenFile | null,
  setOpenFile: Dispatch<SetStateAction<OpenFile | null>>,
  { onConfirm = confirm }: Options = {}
): FileEditingState {
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState<Error | null>(null)
  const openFileRef = useLatestRef(openFile)
  const isDirty = openFile !== null && openFile.content !== openFile.savedContent

  // ファイルが切り替わったら、直前のファイルに対する保存エラーは意味を持たなくなるため
  // クリアする（レンダー中に直接 setState する React 推奨パターン。useEffect 経由だと
  // カスケードするレンダーが発生するため避ける）。これが無いと、保存に失敗したファイルから
  // 別のファイルへ切り替えたときに、無関係な古いエラーが新しいファイルのエディタ上に
  // 表示され続けてしまう。
  const [lastFilePath, setLastFilePath] = useState(openFile?.path ?? null)
  if ((openFile?.path ?? null) !== lastFilePath) {
    setLastFilePath(openFile?.path ?? null)
    setSaveError(null)
  }

  const updateFileContent = (content: string): void => {
    setOpenFile((prev) => (prev === null ? prev : { ...prev, content }))
  }

  const saveFile = async (): Promise<void> => {
    if (openFile === null || isSaving) return
    setIsSaving(true)
    setSaveError(null)
    // 書き込みに使った時点の path/content を捕捉する。await 中にユーザーが
    // さらに編集したり別ファイルへ切り替えたりしても、savedContent には
    // 実際にディスクへ書き込んだ内容だけを反映する（保存中の追加編集を
    // 誤って「保存済み」扱いにしない）。
    const { path, content } = openFile
    try {
      await fileSystemApi.writeFileContent(path, content)
      setOpenFile((prev) =>
        prev !== null && prev.path === path ? { ...prev, savedContent: content } : prev
      )
    } catch (err) {
      // 保存中に別ファイルへ切り替わっていた場合、この保存失敗はもう画面上の
      // ファイルとは無関係なので、無関係なファイルにエラーを表示しない。
      if (openFileRef.current?.path === path) {
        setSaveError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      setIsSaving(false)
    }
  }

  const confirmDiscardIfDirty = (): boolean => !isDirty || onConfirm(DISCARD_CONFIRM_MESSAGE)

  return { isDirty, isSaving, saveError, updateFileContent, saveFile, confirmDiscardIfDirty }
}
