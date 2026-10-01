import { buildDiscardHunkConfirmMessage } from '../lib/discardConfirmMessage'
import { joinPath } from '../lib/pathUtils'

export interface DiscardHunkOptions {
  folderPath: string | null
  /** 開いている diff タブのリポジトリ相対パス(無ければ null) */
  activeDiffTabPath: string | null
  /** useDiffOperations.discardHunk。実行され成功したら true */
  discardHunk: (patch: string) => Promise<boolean>
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  /** useFileSystem.refreshTree。削除されたファイルの復元でツリーの構成が変わり得る */
  refreshTree: () => Promise<unknown>
  onConfirm?: (message: string) => boolean
}

// ハンクの取り消しを「確認 → 取り消し → 成功時だけタブを同期」の順で行う。
// 取り消しは working tree のファイルを直接書き換えるため、開いているタブの内容が古くなる
// (パターン19)。失敗・no-op のときに同期すると、取り消されていないファイルの未保存の編集が
// ディスクの内容で上書きされて失われるため、成功時だけ同期する(パターン20)
export function useDiscardHunk({
  folderPath,
  activeDiffTabPath,
  discardHunk,
  hasDirtyTabAtOrInside,
  reloadOpenFile,
  refreshTree,
  onConfirm = confirm
}: DiscardHunkOptions): (patch: string, hunkHeader: string) => Promise<void> {
  return async (patch, hunkHeader) => {
    if (folderPath === null || activeDiffTabPath === null) return
    const absolutePath = joinPath(folderPath, activeDiffTabPath)
    const message = buildDiscardHunkConfirmMessage({
      path: activeDiffTabPath,
      hunkHeader,
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath)
    })
    if (!onConfirm(message)) return
    if (!(await discardHunk(patch))) return
    await reloadOpenFile(absolutePath)
    // 読み直しの失敗は refreshTree 自身がツリーのエラー表示へ報告するため握り潰す
    await refreshTree().catch(() => undefined)
  }
}
