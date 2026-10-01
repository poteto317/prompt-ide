import { useEffect, useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'
import { isGitOperationDisabled } from '../lib/gitUtils'
import { buildDeleteConfirmMessage, deleteBranchConfirmingForce } from '../lib/branchDeletion'
import { buildMergeConfirmMessage } from '../lib/branchMerge'
import type { GitStatusResult } from '@shared/types'
import type { BranchOperationKind } from '../types'

export interface GitBranchOperationsState {
  /** 実行中のブランチ操作。checkout/作成/削除/マージは1つの busy ref で相互に排他にする
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
  /** 確認 → 安全削除 → 未マージなら再確認して強制削除。戻り値は実際に削除されたか */
  deleteBranch: (branchName: string) => Promise<boolean>
  /** 確認 → 現在のブランチへマージ。戻り値は実行され、作業ツリーが変わったか(確認のキャンセル・
   *  isBusy による no-op・git レベルの失敗では false)。コンフリクトで止まった場合も作業ツリーが
   *  変わる(マーカー入りになる)ため true で、メッセージは branchOperationError に残る
   *  (マージ中が解除されると消える)。
   *  呼び出し元(useAppState.ts)が reloadOpenFiles 等「作業ツリーが変わった前提」の後続処理を
   *  その場合だけ実行するために使う */
  mergeBranch: (branchName: string) => Promise<boolean>
  /** ブランチ操作のエラー。マージがコンフリクトで止まったときの通知もここに入り、
   *  マージ中(gitStatus.mergeInProgress)が解除されたら自動で消える */
  branchOperationError: Error | null
}

export interface GitBranchOperationsOptions {
  /** 削除の確認ダイアログ。テストで差し替えるために注入できるようにする */
  onConfirm?: (message: string) => boolean
}

export function useGitBranchOperations(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  refreshHistory: () => Promise<void>,
  fileLock?: FileOperationLock,
  { onConfirm = confirm }: GitBranchOperationsOptions = {}
): GitBranchOperationsState {
  const [pendingBranchOperation, setPendingBranchOperation] = useState<BranchOperationKind | null>(
    null
  )
  const isBranchOperationRunningRef = useRef(false)
  const [branchOperationError, setBranchOperationError] = useState<Error | null>(null)
  // マージがコンフリクトで止まったときに出した通知(Error オブジェクトの同一性で他のエラーと区別する)
  const conflictNoticeRef = useRef<Error | null>(null)
  const mergeInProgress = gitStatus?.mergeInProgress ?? false

  // マージ中が解除されたら(true → false。effect は値が変わったときだけ走る)、コンフリクトの通知を消す。
  // 完了・中止の経路(バナー・コミット欄でのコミット・CLI の merge --abort)を問わず MERGE_HEAD が
  // 無くなるため、状態に連動させる。通知が別の操作のエラーに置き換わっていれば、そのエラーは消さない
  useEffect(() => {
    if (mergeInProgress) return
    const notice = conflictNoticeRef.current
    if (notice === null) return
    conflictNoticeRef.current = null
    setBranchOperationError((current) => (current === notice ? null : current))
  }, [mergeInProgress])

  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  // 「リポジトリが無ければ Git 操作は実行不可」という業務ルールは
  // useGitRemoteOperations.ts(push/pull/fetch)とも共有するため gitUtils.ts の
  // isGitOperationDisabled に一元化してある(片方だけ判定基準を変えると
  // push/pull/fetch とブランチ操作(checkout/作成/削除/マージ)とで disabled 判定が
  // 食い違ってしまうため)
  const isBranchOperationDisabled = isGitOperationDisabled(gitStatus)

  // refreshGitStatus(ブランチ名・ahead/behind)と refreshHistory(ログ・ブランチ
  // 一覧)は互いに独立したIPC呼び出しのため、直列に待たず並行実行する
  // (useGitOperations.ts の runCommitOperation と同じ理由)
  const runOperation = useRunExclusiveGitOperation(
    () => Promise.all([refreshGitStatus(), refreshHistory()]).then(() => undefined),
    setBranchOperationError
  )

  // checkout/作成/削除/マージに共通の開始条件。ブランチ操作どうしは busy ref で排他にし、
  // 他の Git 操作がロックを持っている間(lock.isAnyLocked())やリポジトリが無い間も待つ
  const isBranchOperationBusy = (): boolean =>
    isBranchOperationRunningRef.current || lock.isAnyLocked() || isBranchOperationDisabled

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
      isBusy: isBranchOperationBusy,
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
      isBusy: isBranchOperationBusy,
      setBusy: makeSetBusy('create'),
      onStart: lock.lockGlobal,
      onEnd: lock.unlockGlobal,
      execute: () => gitApi.createBranch(branchName)
    })

  // 削除するのは現在ではないブランチの ref だけで、working tree/index/HEAD には
  // 触れない(現在ブランチの削除は main 側で拒否する)。push/pull が読み書きする対象と
  // 重ならないため lockGlobal は取らない(取ると削除中に push/pull が無意味に待たされる)。
  // 一方、削除中に checkout/作成が始まると、切替先や一覧の再取得結果が食い違うため、
  // ブランチ操作どうしは busy ref で排他にし、開始条件は checkout と同じく他操作中も待つ
  // (docs/review-findings-patterns.md パターン23)。
  // 安全削除と強制削除(lib/branchDeletion.ts)は1回の排他実行の中で行い、間に他の操作が
  // 割り込まないようにする。2回目の確認でキャンセルされた場合は execute を正常終了させる
  // (エラーは出さない)
  const deleteBranch = async (branchName: string): Promise<boolean> => {
    if (!onConfirm(buildDeleteConfirmMessage(branchName))) return false
    let deleted = false
    const succeeded = await runOperation({
      isBusy: isBranchOperationBusy,
      setBusy: makeSetBusy('delete'),
      execute: async () => {
        deleted = await deleteBranchConfirmingForce({
          branchName,
          deleteBranch: gitApi.deleteBranch,
          confirm: onConfirm
        })
      }
    })
    return succeeded && deleted
  }

  // マージは working tree/index/HEAD を書き換えるため、checkout と同じ理由で lockGlobal を
  // 取る(マージ中に push が始まると、確定前の HEAD を送ってしまう)。開始条件も checkout と
  // 同じく他操作中を待つ。現在のブランチ名が分からない状態(リポジトリが無い)は
  // isBranchOperationDisabled で弾かれる操作のため、確認も出さずに終える。
  // コンフリクトしたら main 側はマージ中の状態を残して conflict の結果で返す(作業ツリーが
  // マーカー入りに変わっているため例外にしない。例外だと呼び出し元がタブを再読込せず、古い内容の
  // タブが保存でマーカーを消してしまう。パターン52)。runOperation は execute の成功時に
  // setError(null) するため、メッセージは実行完了後(戻り値を得てから)にセットする。
  // throw された失敗(事前検証の失敗・フック失敗の中止等)は作業ツリーが変わっていないので
  // 従来どおり false + エラー
  const mergeBranch = async (branchName: string): Promise<boolean> => {
    const currentBranch = gitStatus?.branch
    if (currentBranch === null || currentBranch === undefined) return false
    if (!onConfirm(buildMergeConfirmMessage(branchName, currentBranch))) return false
    let conflictMessage: string | null = null
    const succeeded = await runOperation({
      isBusy: isBranchOperationBusy,
      setBusy: makeSetBusy('merge'),
      onStart: lock.lockGlobal,
      onEnd: lock.unlockGlobal,
      execute: async () => {
        const result = await gitApi.mergeBranch(branchName)
        if (result.status === 'conflict') conflictMessage = result.message
      }
    })
    if (succeeded && conflictMessage !== null) {
      const notice = new Error(conflictMessage)
      conflictNoticeRef.current = notice
      setBranchOperationError(notice)
    }
    return succeeded
  }

  return {
    pendingBranchOperation,
    checkoutBranch,
    createBranch,
    deleteBranch,
    mergeBranch,
    branchOperationError
  }
}
