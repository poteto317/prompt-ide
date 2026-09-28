import { useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'
import { isGitOperationDisabled } from '../lib/gitUtils'
import type { GitStatusResult } from '@shared/types'

export type BranchOperationKind = 'checkout' | 'create' | 'delete'

export interface GitBranchOperationsState {
  /** 実行中のブランチ操作。checkout/作成/削除は1つの busy ref で相互に排他にする
   *  (どれも refs/heads や HEAD を変えるため、並行すると一覧の再取得結果や
   *  切替先の存在が食い違う) */
  pendingBranchOperation: BranchOperationKind | null
  /** 戻り値は実際に checkout が実行され成功したか。isBusy による no-op や
   *  git レベルの失敗では false になる。呼び出し元(useAppState.ts)が
   *  reloadOpenFiles 等「checkout が成功した前提」の後続処理を成功時だけ
   *  実行するために使う */
  checkoutBranch: (branchName: string) => Promise<boolean>
  /** 現在の HEAD から作成して切り替える。戻り値は実行され成功したか */
  createBranch: (branchName: string) => Promise<boolean>
  branchOperationError: Error | null
}

export function useGitBranchOperations(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  refreshHistory: () => Promise<void>,
  fileLock?: FileOperationLock
): GitBranchOperationsState {
  const [pendingBranchOperation, setPendingBranchOperation] = useState<BranchOperationKind | null>(
    null
  )
  const isBranchOperationRunningRef = useRef(false)
  const [branchOperationError, setBranchOperationError] = useState<Error | null>(null)
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  // 「リポジトリが無ければ Git 操作は実行不可」という業務ルールは
  // useGitRemoteOperations.ts(push/pull/fetch)とも共有するため gitUtils.ts の
  // isGitOperationDisabled に一元化してある(片方だけ判定基準を変えると
  // push/pull/fetch とブランチ切替とで disabled 判定が食い違ってしまうため)
  const isBranchOperationDisabled = isGitOperationDisabled(gitStatus)

  // refreshGitStatus(ブランチ名・ahead/behind)と refreshHistory(ログ・ブランチ
  // 一覧)は互いに独立したIPC呼び出しのため、直列に待たず並行実行する
  // (useGitOperations.ts の runCommitOperation と同じ理由)
  const runOperation = useRunExclusiveGitOperation(
    () => Promise.all([refreshGitStatus(), refreshHistory()]).then(() => undefined),
    setBranchOperationError
  )

  // 操作ごとの setBusy を作る。ref(同期判定用)と state(表示用)を同時に更新する
  const makeSetBusy =
    (kind: BranchOperationKind) =>
    (busy: boolean): void => {
      isBranchOperationRunningRef.current = busy
      setPendingBranchOperation(busy ? kind : null)
    }

  // checkout は working tree/index/HEAD を書き換えるため、pull と同じ理由で
  // ハンク操作/commit/amend/pull 実行中(lock.isAnyLocked())は待つ。自身も
  // lock.lockGlobal() を呼ぶことで、push 側の既存の isBusy 判定
  // (lock.isAnyLocked() を含む)が自動的に「checkout実行中は push しない」を
  // 成立させる(push 側のコード変更は不要。「コミットしてすぐプッシュ」と
  // 同じ理由で、checkout中にpushすると古いHEADを送ってしまうレースを防ぐ)。
  // 逆方向(push実行中のcheckout)は、pushがworking tree/index/HEADのいずれも
  // 書き換えないため安全と判断し、isBusyにpush実行中判定を含めない
  const checkoutBranch = (branchName: string): Promise<boolean> =>
    runOperation({
      isBusy: () =>
        isBranchOperationRunningRef.current || lock.isAnyLocked() || isBranchOperationDisabled,
      setBusy: makeSetBusy('checkout'),
      onStart: lock.lockGlobal,
      onEnd: lock.unlockGlobal,
      execute: () => gitApi.checkoutBranch(branchName)
    })

  // checkout -b は HEAD の参照先を変える(working tree/index は変えない)。checkout と
  // 同じ理由で、作成中に push が始まると「どのブランチを送るか」が確定する前の HEAD を
  // 読んでしまうため lockGlobal を取る(push 側の isAnyLocked() 判定で自動的に待つ)
  const createBranch = (branchName: string): Promise<boolean> =>
    runOperation({
      isBusy: () =>
        isBranchOperationRunningRef.current || lock.isAnyLocked() || isBranchOperationDisabled,
      setBusy: makeSetBusy('create'),
      onStart: lock.lockGlobal,
      onEnd: lock.unlockGlobal,
      execute: () => gitApi.createBranch(branchName)
    })

  return { pendingBranchOperation, checkoutBranch, createBranch, branchOperationError }
}
