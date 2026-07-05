import { useRef, useState, type Dispatch, type SetStateAction } from 'react'
import type { OpenFile } from '../types'
import * as fileSystemApi from '../lib/fileSystemApi'

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
  resetForFileChange: () => void
  confirmDiscardIfDirty: () => boolean
}

export function useFileEditing(
  openFile: OpenFile | null,
  setOpenFile: Dispatch<SetStateAction<OpenFile | null>>,
  { onConfirm = confirm }: Options = {}
): FileEditingState {
  // 保存中のファイルの path を保持する。isSaving は単一の boolean ではなく
  // path で比較することで、「file A の保存中に file B を保存しようとしたら
  // ブロックされる」という無関係なファイル間の干渉を防ぐ（多重保存防止は
  // 同一 path への再入のみをガードすれば十分なため）。
  const [savingPath, setSavingPath] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<Error | null>(null)
  const isDirty = openFile !== null && openFile.content !== openFile.savedContent
  const isSaving = openFile !== null && savingPath === openFile.path

  // 現在表示中のファイルの path を、保存完了時に「表示中のファイルと保存対象が
  // 一致するか」を判定するために追跡する。値が変わったときだけ render 中に
  // 直接代入することで、useEffect 経由よりも早く（コミット前の時点で）最新値を
  // 反映できる。
  const currentPathRef = useRef(openFile?.path ?? null)
  if (currentPathRef.current !== (openFile?.path ?? null)) {
    currentPathRef.current = openFile?.path ?? null
  }

  // 「編集セッション」の世代カウンタ。ファイルを開き直す（selectFile/openFolder
  // で新しく読み込む）たびに呼び出し側から resetForFileChange() を呼んで
  // インクリメントしてもらう。同じ path のファイルを一度閉じて（保存中に破棄
  // 確認を経て）再度開き直した場合でも世代が変わるため、path 文字列だけを
  // 見て「同じ編集セッション」だと誤判定しない。
  const generationRef = useRef(0)

  // 同一ファイルへの多重保存（連打・Cmd+Sの連続入力）を同期的に防ぐ。React
  // state の savingPath だけに頼ると、同一レンダー内で saveFile() が連続で
  // 呼ばれた場合に setState のバッチングにより両方とも古い値を見てガードを
  // すり抜けてしまうため、即座に反映される ref で判定する。
  const savingRef = useRef<{ path: string; generation: number } | null>(null)

  const updateFileContent = (content: string): void => {
    setOpenFile((prev) => (prev === null ? prev : { ...prev, content }))
  }

  // ファイルを切り替えた（別ファイルを開いた・同じファイルを開き直した・
  // フォルダを開き直した）ときに、呼び出し側(useFileSystem)から明示的に
  // 呼んでもらう。世代をインクリメントし、直前の編集セッションに対する
  // 保存エラーをクリアする。これが無いと、保存に失敗したファイルから
  // 切り替えても（あるいは同じファイルを開き直しても）、無関係になった
  // 古いエラーがエディタ上に表示され続けてしまう。
  const resetForFileChange = (): void => {
    generationRef.current += 1
    setSaveError(null)
  }

  const saveFile = async (): Promise<void> => {
    if (openFile === null) return
    const { path, content } = openFile
    if (savingRef.current?.path === path) return
    const generation = generationRef.current
    savingRef.current = { path, generation }
    setSavingPath(path)
    setSaveError(null)
    try {
      await fileSystemApi.writeFileContent(path, content)
      // 書き込みに使った時点の path/content/generation を捕捉しているため、
      // await 中にユーザーがさらに編集したり、別ファイルへ切り替えたり、
      // 同じファイルを開き直したりしても、savedContent には実際にディスクへ
      // 書き込んだ内容だけが、その保存が対象としていた編集セッションに
      // 限定して反映される。
      setOpenFile((prev) =>
        prev !== null && prev.path === path && generation === generationRef.current
          ? { ...prev, savedContent: content }
          : prev
      )
    } catch (err) {
      // 保存中に別ファイルへ切り替わっていた、または同じファイルを開き直して
      // いた場合、この保存失敗はもう画面上の編集セッションとは無関係なので
      // エラーを表示しない。
      if (currentPathRef.current === path && generation === generationRef.current) {
        setSaveError(err instanceof Error ? err : new Error(String(err)))
      }
    } finally {
      if (savingRef.current?.path === path && savingRef.current.generation === generation) {
        savingRef.current = null
      }
      setSavingPath((prev) => (prev === path ? null : prev))
    }
  }

  const confirmDiscardIfDirty = (): boolean => !isDirty || onConfirm(DISCARD_CONFIRM_MESSAGE)

  return {
    isDirty,
    isSaving,
    saveError,
    updateFileContent,
    saveFile,
    resetForFileChange,
    confirmDiscardIfDirty
  }
}
