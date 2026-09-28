import { useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { toError } from '../lib/errorUtils'
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

interface RemoteOperationOptions {
  /** 開始条件。true を返す間は execute を呼ばずに no-op で返す */
  isBusy: () => boolean
  /** 実行中フラグ(ref と state の両方)の更新。開始時に true、終了時に false で呼ばれる */
  setBusy: (busy: boolean) => void
  /** 実行開始直後(execute の前)に呼ぶ副作用。ロック取得等 */
  onStart?: () => void
  /** 実行終了時(refreshGitStatus 完了後)に呼ぶ副作用。ロック解放等 */
  onEnd?: () => void
  execute: () => Promise<void>
}

// fetch/pull/push はいずれも「開始条件を満たすか判定 → busy 化(必要なら副作用も) →
// 実行 → 成功/失敗を remoteOperationError へ反映 → refreshGitStatus(失敗は無視) →
// busy 解除(副作用の後始末も)」という同じ手順を辿る。異なるのは開始条件・busy
// フラグの実体・ロックの要否だけなので、手順そのものは1箇所にまとめ、各操作は
// 「何を」「どの条件で」実行するかだけを渡す(useGitOperations.ts の
// runStageOperation/runCommitOperation と同じ考え方)
function useRunRemoteOperation(
  refreshGitStatus: () => Promise<void>,
  setRemoteOperationError: (err: Error | null) => void
): (options: RemoteOperationOptions) => Promise<void> {
  return async ({ isBusy, setBusy, onStart, onEnd, execute }) => {
    if (isBusy()) return
    setBusy(true)
    onStart?.()
    try {
      await execute()
      setRemoteOperationError(null)
    } catch (err) {
      setRemoteOperationError(toError(err))
    } finally {
      // 操作自体(execute)が成功していた場合、refreshGitStatus 自体の失敗理由で
      // remoteOperationError を上書きしない(useGitOperations.ts の
      // runStageOperation/runCommitOperation と同じ理由)
      try {
        await refreshGitStatus()
      } catch {
        // 握りつぶす(git status の取得エラーは useGitStatus 側が自前で扱う)
      } finally {
        setBusy(false)
        onEnd?.()
      }
    }
  }
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
  const runRemoteOperation = useRunRemoteOperation(refreshGitStatus, setRemoteOperationError)
  // 「リポジトリが無ければ push/pull/fetch は実行不可」という業務ルール。
  // ここに一元化し、各操作の isBusy 判定と UI 向けの isRemoteOperationDisabled
  // の両方がこの1つの値を参照する
  const isRemoteOperationDisabled = gitStatus === null || !gitStatus.isRepo

  // fetch はリモート追跡ref のみ更新し working tree/index を変更しないため、
  // stage/unstage/commit/ハンク操作/pull のいずれとも排他不要。自身の多重発火
  // だけ防ぐ
  const fetchRemote = (): Promise<void> =>
    runRemoteOperation({
      isBusy: () => isFetchingRef.current || isRemoteOperationDisabled,
      setBusy: (busy) => {
        isFetchingRef.current = busy
        setIsFetching(busy)
      },
      execute: gitApi.fetchRemote
    })

  // pull は working tree・index を書き換えるため、stage/unstage/commit/
  // ハンク操作(共有ロック経由)・push と同時に走らせると .git/index の競合や
  // 意図しない内容の反映が起きる。commit と同様に共有ロックを全体ロックし、
  // 開始条件で lock.isAnyLocked()(ハンク操作中 or commit 中。lockGlobal も
  // isAnyLocked に含まれる、useFileOperationLock.ts 参照)を見る
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
    })

  // push はローカルの index/working tree を変更しないため、stage/unstage
  // (git add/reset)自体とは理屈上同時実行しても壊れない。ただし
  // lock.isAnyLocked() はハンク操作(git apply --cached)実行中と commit/amend
  // 実行中(lockGlobal)の両方で true になり、後者は無視できない: HEAD を
  // 書き換える途中に push が古い HEAD を読むと、ローカルは書き換え後を指す
  // のにリモートには書き換え前が届く取り違えが起きる(「コミットしてすぐ
  // プッシュ」は一般的な操作パターン)。ハンク操作中まで含めて待たせるのは
  // 副次的な制約だが、commit/amend との区別を lock 側は提供しないため、
  // pull と同じ条件で待たせる。加えて pull(working tree/index を書き換える)・
  // 自分自身(push)の実行中に重ねて呼ぶと結果が曖昧になるため、それらの間も
  // 待たせる。fetch とは非排他(fetch はリモート追跡ref のみ更新するため、
  // fetchRemote() のコメントと同じ理由で待たせない。ref ロック競合による
  // 一時的な失敗はあり得るが、既知のトレードオフとして許容する)
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
    })

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
