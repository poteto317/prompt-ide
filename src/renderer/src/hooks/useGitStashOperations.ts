import { useRef, useState } from 'react'
import type { GitStashEntry, GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { buildStashDropConfirmMessage } from '../lib/stashConfirmMessage'
import { isGitOperationDisabled } from '../lib/gitUtils'
import type { PendingStashOperation } from '../types'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'

export interface GitStashOperationsState {
  /** 実行中の stash 操作と、その対象(push は stash がまだ無いので sha が null) */
  pendingStashOperation: PendingStashOperation | null
  /** stash する。戻り値は実際に実行され成功したか(useAppState が成功時だけ再読込するために使う) */
  pushStash: (message: string) => Promise<boolean>
  /** 戻す。戻り値は実際に実行され、作業ツリーが変わったか(復元は済んだが一覧から消せなかった等の警告つきも true) */
  popStash: (sha: string) => Promise<boolean>
  /** 確認 → 削除。戻り値は実際に削除されたか */
  dropStash: (entry: GitStashEntry) => Promise<boolean>
  stashOperationError: Error | null
}

export interface GitStashOperationsOptions {
  /** 削除の確認ダイアログ。テストで差し替えるために注入できるようにする */
  onConfirm?: (message: string) => boolean
}

// useGitBranchOperations と同じ作り: stash 操作どうしは busy ref で排他にし、他の Git 操作が
// ロックを持っている間(lock.isAnyLocked())やリポジトリが無い間も待つ。
// stash・復元は作業ツリー/index を書き換えるため lockGlobal を取る(実行中の push・ステージ・
// ブランチ操作を待たせる。pull・checkout と同じ理由)。削除は作業ツリーに触れないため取らない
// (取ると削除中に push/pull が無意味に待たされる。ブランチ削除と同じ扱い)
export function useGitStashOperations(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  refreshStashes: () => Promise<void>,
  fileLock?: FileOperationLock,
  { onConfirm = confirm }: GitStashOperationsOptions = {}
): GitStashOperationsState {
  const [pendingStashOperation, setPendingStashOperation] = useState<PendingStashOperation | null>(
    null
  )
  const isRunningRef = useRef(false)
  const [stashOperationError, setStashOperationError] = useState<Error | null>(null)
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  const isDisabled = isGitOperationDisabled(gitStatus)

  // ステータスと一覧は互いに独立した IPC のため並行して再取得する
  const runOperation = useRunExclusiveGitOperation(
    () => Promise.all([refreshGitStatus(), refreshStashes()]).then(() => undefined),
    setStashOperationError
  )

  const isBusy = (): boolean => isRunningRef.current || lock.isAnyLocked() || isDisabled

  const makeSetBusy =
    (pending: PendingStashOperation) =>
    (busy: boolean): void => {
      isRunningRef.current = busy
      setPendingStashOperation(busy ? pending : null)
    }

  const pushStash = (message: string): Promise<boolean> =>
    runOperation({
      isBusy,
      setBusy: makeSetBusy({ kind: 'push', sha: null }),
      onStart: lock.lockGlobal,
      onEnd: lock.unlockGlobal,
      execute: () => gitApi.stashPush(message)
    })

  // 戻す。dropFailed / rollbackFailed は「作業ツリーが変わったが警告が要る」結果で、成功扱い(true)にして
  // 呼び出し側にタブ・ツリーを再読込させつつ、警告を stashOperationError に出す。
  // runOperation は execute の成功時に setError(null) するため、警告はその後(戻り値を得てから)にセットする。
  // throw された失敗(事前検証の失敗・巻き戻しに成功した apply 失敗)は作業ツリーが変わっていないので
  // 従来どおり false + エラー(再読込しない)
  const popStash = async (sha: string): Promise<boolean> => {
    let warning: string | null = null
    const succeeded = await runOperation({
      isBusy,
      setBusy: makeSetBusy({ kind: 'pop', sha }),
      onStart: lock.lockGlobal,
      onEnd: lock.unlockGlobal,
      execute: async () => {
        const result = await gitApi.stashPop(sha)
        if (result.status !== 'restored') warning = result.message
      }
    })
    if (succeeded && warning !== null) setStashOperationError(new Error(warning))
    return succeeded
  }

  const dropStash = async (entry: GitStashEntry): Promise<boolean> => {
    if (!onConfirm(buildStashDropConfirmMessage(entry.message))) return false
    return runOperation({
      isBusy,
      setBusy: makeSetBusy({ kind: 'drop', sha: entry.sha }),
      execute: () => gitApi.stashDrop(entry.sha)
    })
  }

  return { pendingStashOperation, pushStash, popStash, dropStash, stashOperationError }
}
