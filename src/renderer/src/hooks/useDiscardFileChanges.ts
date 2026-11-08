import type { GitFileStatus } from '@shared/types'
import { buildDiscardConfirmMessage } from '../lib/discardConfirmMessage'
import { resolveDiscardTarget } from '../lib/discardTarget'

export interface DiscardFileChangesOptions {
  folderPath: string | null
  /** git status のファイル一覧(未追跡・intent-to-add かどうかの判定に使う) */
  files: GitFileStatus[]
  /** useGitOperations.discardFile。実行され成功したら true */
  discardFile: (path: string) => Promise<boolean>
  hasDirtyTabAtOrInside: (absolutePath: string) => boolean
  reloadOpenFile: (absolutePath: string) => Promise<void>
  closeTabsAtOrInside: (absolutePath: string) => void
  /** useFileSystem.refreshTree。ファイルツリーをルートから読み直す(戻り値は使わない) */
  refreshTree: () => Promise<unknown>
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
  refreshTree,
  onConfirm = confirm
}: DiscardFileChangesOptions): (path: string) => Promise<boolean> {
  return async (path) => {
    // 対象の解決(絶対パス・ゴミ箱へ移すか)は lib/discardTarget.ts に任せ、ここでは
    // 確認 → 取り消し → 同期の順序だけを担う
    const target = resolveDiscardTarget({ folderPath, files, path })
    if (target === null) return false
    const { absolutePath, movesToTrash } = target
    const message = buildDiscardConfirmMessage({
      path,
      movesToTrash,
      hasUnsavedEdits: hasDirtyTabAtOrInside(absolutePath)
    })
    if (!onConfirm(message)) return false
    const succeeded = await discardFile(path)
    if (!succeeded) return false
    if (movesToTrash) closeTabsAtOrInside(absolutePath)
    else await reloadOpenFile(absolutePath)
    // ゴミ箱へ移した未追跡ファイルがツリーに残る(クリックすると開けない)・復元された削除済みファイルが
    // ツリーに現れない、を操作の直後に解消するため読み直す(フォルダの監視の通知は合流の待ちの後に届き、
    // Linux では監視を張らない)。追跡済み・未追跡のどちらでもツリーの構成が変わり得るため、成功時は常に読み直す。
    // 読み直しの失敗は refreshTree 自身がツリーのエラー表示へ報告するため、ここでは
    // 握り潰して取り消しの成功を返す(最終レビューで追加)
    await refreshTree().catch(() => undefined)
    return true
  }
}
