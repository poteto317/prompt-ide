import { useRef, useState } from 'react'
import type { GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { buildDiscardAllConfirmMessage } from '../lib/discardConfirmMessage'
import { movesToTrashOnDiscard } from '../lib/discardTarget'
import { runEditorSyncedOperation } from '../lib/editorSyncedOperation'
import { isGitOperationDisabled, isUnstagedFile } from '../lib/gitUtils'
import type { DiscardAllState } from '../types'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'

export interface DiscardAllChangesOptions {
  gitStatus: GitStatusResult | null
  refreshGitStatus: () => Promise<void>
  /** ブランチ操作・退避などと共有するロック(作業ツリーを書き換えるため lockGlobal を取る) */
  fileLock: FileOperationLock
  /** useFileSystem.confirmDiscardAnyDirty。未保存編集の破棄確認 */
  confirmDiscardAnyDirty: () => boolean
  /** useFileSystem.reloadOpenFiles。開いているタブをディスクから読み直す */
  reloadOpenFiles: () => Promise<void>
  /** useFileSystem.refreshTree。未追跡ファイルの移動・削除ファイルの復元でツリーの構成が変わる */
  refreshTree: () => Promise<unknown>
  /** 取り消しの確認ダイアログ。テストで差し替えるために注入できるようにする */
  onConfirm?: (message: string) => boolean
}

// 未ステージの変更をすべて取り消す。useGitStashOperations と同じ作りで、自分の busy ref +
// 他の Git 操作のロック(fileLock.isAnyLocked())+ リポジトリの有無で排他にし、作業ツリーを
// 書き換えるため lockGlobal を取る。
// 順序は「busy 判定 → 取り消しの確認 → 未保存編集の破棄確認 → ロック → 取り消し → 成功時だけ
// タブとツリーを再読込」。busy 判定を確認の前に置くのは、確認だけ出して no-op になるのを防ぐため。
// 確認を拒否したときはロックを取らない。失敗時に再読込すると取り消されていないファイルの
// 未保存編集が失われるため、成功時だけ再読込する(パターン20)。ただし途中失敗で一部が取り消し済みの
// ときは main が partial を返すので、それは再読込する(パターン52)
export function useDiscardAllChanges({
  gitStatus,
  refreshGitStatus,
  fileLock,
  confirmDiscardAnyDirty,
  reloadOpenFiles,
  refreshTree,
  onConfirm = confirm
}: DiscardAllChangesOptions): DiscardAllState {
  const [isDiscarding, setIsDiscarding] = useState(false)
  const isRunningRef = useRef(false)
  const [error, setError] = useState<Error | null>(null)
  const runOperation = useRunExclusiveGitOperation(refreshGitStatus, setError)
  const isBusy = (): boolean =>
    isRunningRef.current || fileLock.isAnyLocked() || isGitOperationDisabled(gitStatus)

  const onDiscardAll = async (): Promise<void> => {
    const files = gitStatus?.files.filter(isUnstagedFile) ?? []
    if (files.length === 0 || isBusy()) return
    const trashCount = files.filter(movesToTrashOnDiscard).length
    if (!onConfirm(buildDiscardAllConfirmMessage({ count: files.length, trashCount }))) return
    await runEditorSyncedOperation({
      confirmDiscardAnyDirty,
      reloadOpenFiles,
      operation: async () => {
        let warning: string | null = null
        const succeeded = await runOperation({
          isBusy,
          setBusy: (busy) => {
            isRunningRef.current = busy
            setIsDiscarding(busy)
          },
          onStart: fileLock.lockGlobal,
          onEnd: fileLock.unlockGlobal,
          // 確認時点の件数を渡す。main 側が現在の件数と食い違えば中止する
          execute: async () => {
            const result = await gitApi.discardAll(files.length)
            if (result.status === 'partial') warning = result.message
          }
        })
        // partial は一部が取り消し済み(作業ツリーが変わった)ので成功扱いで再読込させる。runOperation は
        // 成功時に setError(null) するため、警告はその後にセットする。throw された失敗は何も変わっていない
        if (succeeded && warning !== null) setError(new Error(warning))
        // ツリーの読み直しの失敗はツリー側が自身のエラー表示へ報告するため、タブの再読込を止めない
        if (succeeded) await refreshTree().catch(() => undefined)
        return succeeded
      }
    })
  }

  return { isDiscarding, error, onDiscardAll }
}
