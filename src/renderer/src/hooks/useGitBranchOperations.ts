import { useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'
import { isGitOperationDisabled } from '../lib/gitUtils'
import type { GitStatusResult } from '@shared/types'

export interface GitBranchOperationsState {
  isCheckingOut: boolean
  /** 戻り値は実際に checkout が実行され成功したか。isBusy による no-op や
   *  git レベルの失敗では false になる。呼び出し元(useAppState.ts)が
   *  reloadOpenFiles 等「checkout が成功した前提」の後続処理を成功時だけ
   *  実行するために使う */
  checkoutBranch: (branchName: string) => Promise<boolean>
  branchOperationError: Error | null
}

export function useGitBranchOperations(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  refreshHistory: () => Promise<void>,
  fileLock?: FileOperationLock
): GitBranchOperationsState {
  const [isCheckingOut, setIsCheckingOut] = useState(false)
  const isCheckingOutRef = useRef(false)
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
      isBusy: () => isCheckingOutRef.current || lock.isAnyLocked() || isBranchOperationDisabled,
      setBusy: (busy) => {
        isCheckingOutRef.current = busy
        setIsCheckingOut(busy)
      },
      onStart: lock.lockGlobal,
      onEnd: lock.unlockGlobal,
      execute: () => gitApi.checkoutBranch(branchName)
    })

  return { isCheckingOut, checkoutBranch, branchOperationError }
}
