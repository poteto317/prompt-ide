import type { GitFileStatus } from '@shared/types'
import { isUntrackedFile } from '../lib/gitUtils'
import { joinPath } from '../lib/pathUtils'
import { buildDiscardConfirmMessage } from '../lib/discardConfirmMessage'

export interface DiscardFileChangesOptions {
  folderPath: string | null
  /** git status のファイル一覧(未追跡かどうかの判定に使う) */
  files: GitFileStatus[]
  /** useGitOperations.discardFile。実行され成功したら true */
  discardFile: (path: string) => Promise<boolean>
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  closeTabsAtOrInside: (absolutePath: string) => void
  onConfirm?: (message: string) => boolean
}

// 変更の取り消しを「確認 → 取り消し → 成功時だけタブを同期」の順で行う。
// 取り消しは working tree のファイルを直接書き換える(未追跡はゴミ箱へ移す)ため、
// エディタで開いているタブの内容が古くなる(docs/review-findings-patterns.md パターン19)。
// 失敗・no-op のときに同期すると、取り消されていないファイルの未保存の編集が
// ディスクの内容で上書きされて失われるため、成功時だけ同期する(パターン20)。
// 取り消し実行中に対象ファイルへ保存が割り込むレースは、ブランチ切り替え
// (useAppState.ts の checkoutBranch)と同じ既知の制約として扱う
export function useDiscardFileChanges({
  folderPath,
  files,
  discardFile,
  hasDirtyTabAtOrInside,
  reloadOpenFile,
  closeTabsAtOrInside,
  onConfirm = confirm
}: DiscardFileChangesOptions): (path: string) => Promise<boolean> {
  return async (path) => {
    if (folderPath === null) return false
    const absolutePath = joinPath(folderPath, path)
    const file = files.find((f) => f.path === path)
    const isUntracked = file !== undefined && isUntrackedFile(file)
    const message = buildDiscardConfirmMessage({
      path,
      isUntracked,
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath)
    })
    if (!onConfirm(message)) return false
    const succeeded = await discardFile(path)
    if (!succeeded) return false
    if (isUntracked) closeTabsAtOrInside(absolutePath)
    else await reloadOpenFile(absolutePath)
    return true
  }
}
