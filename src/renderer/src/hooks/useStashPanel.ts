import type { GitStatusResult } from '@shared/types'
import { runEditorSyncedOperation } from '../lib/editorSyncedOperation'
import type { StashPanelState } from '../types'
import type { FileOperationLock } from './useFileOperationLock'
import { useGitStashes } from './useGitStashes'
import { useGitStashOperations } from './useGitStashOperations'

export interface StashPanelOptions {
  folderPath: string | null
  gitStatus: GitStatusResult | null
  refreshGitStatus: () => Promise<void>
  /** ブランチ操作などと共有するロック(stash・復元が作業ツリーを書き換えるため相互に待たせる) */
  fileOperationLock: FileOperationLock
  /** useFileSystem.confirmDiscardAnyDirty。未保存編集の破棄確認 */
  confirmDiscardAnyDirty: () => boolean
  /** useFileSystem.reloadOpenFiles。開いているタブをディスクから読み直す */
  reloadOpenFiles: () => Promise<void>
  /** useFileSystem.refreshTree。ファイルツリーをルートから読み直す(戻り値は使わない) */
  refreshTree: () => Promise<unknown>
}

// stash セクションが受け取る状態と操作を組み立てる。
// stash は一覧の取得(useGitStashes)と操作(useGitStashOperations)に分ける。操作は作業ツリーを
// 書き換えるため、ブランチ操作と同じ fileOperationLock を共有して相互に待たせる
export function useStashPanel({
  folderPath,
  gitStatus,
  refreshGitStatus,
  fileOperationLock,
  confirmDiscardAnyDirty,
  reloadOpenFiles,
  refreshTree
}: StashPanelOptions): StashPanelState {
  const gitStashes = useGitStashes(folderPath)
  const gitStashOperations = useGitStashOperations(
    gitStatus,
    refreshGitStatus,
    gitStashes.refreshStashes,
    fileOperationLock
  )
  // stash・復元も checkout・マージと同じく working tree を書き換えるため、runEditorSyncedOperation で
  // 「未保存編集の破棄確認 → 操作 → 成功時のみタブを再読込」にする。stash は未追跡ファイルを消し、
  // 復元は未追跡ファイルを作るため、成功後はファイルツリーも読み直す(変更の取り消しと同じ理由。操作の直後に反映する。
  // フォルダの監視の通知は合流の待ちの後に届き、Linux では監視を張らない)。ツリーの読み直しの失敗はツリー側が自身のエラー表示へ報告するため、
  // タブの再読込を止めない
  const refreshTreeAfter = async (operation: () => Promise<boolean>): Promise<boolean> => {
    const succeeded = await operation()
    if (succeeded) {
      try {
        await refreshTree()
      } catch {
        // 握りつぶす(ツリー側のエラー表示で扱う)
      }
    }
    return succeeded
  }
  // 復元(pop)の戻り値 true は「作業ツリーが変わった」を意味する(main の stashPop は、apply 成功後の drop 失敗や
  // 巻き戻し失敗を例外ではなく結果で返し、useGitStashOperations.popStash がそれを true にする)。
  // 事前検証の失敗や巻き戻しに成功した失敗はディスクが変わらないため false で、未保存編集を守るために再読込しない
  const syncedStashOperation = (operation: () => Promise<boolean>): Promise<void> =>
    runEditorSyncedOperation({
      confirmDiscardAnyDirty,
      reloadOpenFiles,
      operation: () => refreshTreeAfter(operation)
    })
  return {
    entries: gitStashes.stashes,
    pendingOperation: gitStashOperations.pendingStashOperation,
    error: gitStashOperations.stashOperationError,
    onPush: (message) => syncedStashOperation(() => gitStashOperations.pushStash(message)),
    onPop: (sha) => syncedStashOperation(() => gitStashOperations.popStash(sha)),
    onDrop: gitStashOperations.dropStash
  }
}
