import { useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'
import { isGitOperationDisabled } from '../lib/gitUtils'
import type { GitStatusResult } from '@shared/types'

export interface GitRemoteOperationsState {
  isPushing: boolean
  isPulling: boolean
  isFetching: boolean
  /** push と同時実行できない他操作(pull)が進行中で、push を要求しても no-op に
   *  なる状態か。「push/pull は同時実行不可」という業務ルールの判定はここに
   *  閉じ、UI(SourceControlToolbar)側はこの値をそのまま disabled に使うだけで
   *  同じルールを再実装しない */
  isPushBlocked: boolean
  /** pull と同時実行できない他操作(push、またはハンク操作/commit 中のロック)が
   *  進行中で、pull を要求しても no-op になる状態か。isPushBlocked と同じ理由 */
  isPullBlocked: boolean
  /** リポジトリが無い(gitStatus が null、または isRepo: false)ため push/pull/fetch
   *  がそもそも実行不可能な状態か。「リポジトリが無ければ実行不可」という
   *  業務ルールもここに一元化し、UI(SourceControlToolbar)側は gitStatus 自体を
   *  知らずにこの値をそのまま disabled に使うだけにする */
  isRemoteOperationDisabled: boolean
  push: () => Promise<void>
  pull: () => Promise<void>
  fetchRemote: () => Promise<void>
  remoteOperationError: Error | null
}

export function useGitRemoteOperations(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  fileLock?: FileOperationLock
): GitRemoteOperationsState {
  const [isPushing, setIsPushing] = useState(false)
  const isPushingRef = useRef(false)
  const [isPulling, setIsPulling] = useState(false)
  const isPullingRef = useRef(false)
  const [isFetching, setIsFetching] = useState(false)
  const isFetchingRef = useRef(false)
  const [remoteOperationError, setRemoteOperationError] = useState<Error | null>(null)
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  const runRemoteOperation = useRunExclusiveGitOperation(refreshGitStatus, setRemoteOperationError)
  // 「リポジトリが無ければ Git 操作は実行不可」という業務ルールは
  // useGitBranchOperations.ts(ブランチ切替)とも共有するため gitUtils.ts の
  // isGitOperationDisabled に一元化してある(片方だけ判定基準を変えると
  // push/pull/fetch とブランチ切替とで disabled 判定が食い違ってしまうため)
  const isRemoteOperationDisabled = isGitOperationDisabled(gitStatus)

  // fetch はリモート追跡ref のみ更新し working tree/index を変更しないため、
  // stage/unstage/commit/ハンク操作/pull のいずれとも排他不要。自身の多重発火
  // だけ防ぐ
  // runRemoteOperation(useRunExclusiveGitOperation)は「実際に実行され成功したか」
  // を呼び出し元(useGitBranchOperations.ts の checkoutBranch)が使えるよう
  // Promise<boolean> を返す設計になっている。push/pull/fetch は戻り値を使わない
  // ため、公開する型(Promise<void>)に合わせて捨てる
  const fetchRemote = (): Promise<void> =>
    runRemoteOperation({
      isBusy: () => isFetchingRef.current || isRemoteOperationDisabled,
      setBusy: (busy) => {
        isFetchingRef.current = busy
        setIsFetching(busy)
      },
      execute: gitApi.fetchRemote
    }).then(() => undefined)

  // pull は working tree・index を書き換えるため、stage/unstage/commit/
  // ハンク操作(共有ロック経由)・push・checkout/ブランチ作成/マージ
  // (useGitBranchOperations.ts)と同時に走らせると .git/index の競合や意図しない
  // 内容の反映が起きる。commit/checkout と同様に共有ロックを全体ロックし、
  // 開始条件で lock.isAnyLocked()(ハンク操作中・commit 中・checkout/ブランチ作成/
  // マージ中。lockGlobal も isAnyLocked に含まれる、useFileOperationLock.ts 参照)を見る
  const pull = (): Promise<void> =>
    runRemoteOperation({
      isBusy: () =>
        isPullingRef.current ||
        isPushingRef.current ||
        lock.isAnyLocked() ||
        isRemoteOperationDisabled,
      setBusy: (busy) => {
        isPullingRef.current = busy
        setIsPulling(busy)
      },
      onStart: lock.lockGlobal,
      onEnd: lock.unlockGlobal,
      execute: gitApi.pull
    }).then(() => undefined)

  // push はローカルの index/working tree を変更しないため、stage/unstage
  // (git add/reset)自体とは理屈上同時実行しても壊れない。ただし
  // lock.isAnyLocked() はハンク操作(git apply --cached)実行中、commit/amend
  // 実行中(lockGlobal)、および checkout/ブランチ作成/マージ
  // (useGitBranchOperations.ts が同じ理由で lockGlobal を呼ぶ。削除は取らない)の
  // 5つで true に
  // なり、いずれも無視できない: HEAD を書き換える途中に push が古い HEAD を
  // 読むと、ローカルは書き換え後を指すのにリモートには書き換え前が届く取り
  // 違えが起きる(「コミットしてすぐプッシュ」「ブランチを切り替えてすぐ
  // プッシュ」はどちらも一般的な操作パターン)。ハンク操作中まで含めて
  // 待たせるのは副次的な制約だが、commit/amend/checkout/作成/マージ との区別を lock 側は
  // 提供しないため、pull と同じ条件で待たせる。加えて pull(working tree/index
  // を書き換える)・自分自身(push)の実行中に重ねて呼ぶと結果が曖昧になるため、
  // それらの間も待たせる。fetch とは非排他(fetch はリモート追跡ref のみ更新
  // するため、fetchRemote() のコメントと同じ理由で待たせない。ref ロック競合
  // による一時的な失敗はあり得るが、既知のトレードオフとして許容する)
  const push = (): Promise<void> =>
    runRemoteOperation({
      isBusy: () =>
        isPushingRef.current ||
        isPullingRef.current ||
        lock.isAnyLocked() ||
        isRemoteOperationDisabled,
      setBusy: (busy) => {
        isPushingRef.current = busy
        setIsPushing(busy)
      },
      execute: gitApi.push
    }).then(() => undefined)

  // isBusy() 内の判定(ref を見る、実行開始の可否そのもの)とは別に、レンダーに
  // 反映される state 値から「他操作起因で押せないか」を計算する。値の出所
  // (push/pull が同時実行不可、両者ともハンク操作/commit 中も不可)は isBusy()
  // と同じ業務ルールだが、ここでは UI 表示のために毎レンダー計算し直す
  const isPushBlocked = isPulling || lock.isAnyLocked()
  const isPullBlocked = isPushing || lock.isAnyLocked()

  return {
    isPushing,
    isPulling,
    isFetching,
    isPushBlocked,
    isPullBlocked,
    isRemoteOperationDisabled,
    push,
    pull,
    fetchRemote,
    remoteOperationError
  }
}
