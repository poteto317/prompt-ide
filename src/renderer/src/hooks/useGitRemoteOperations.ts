import { useCallback, useRef, useState } from 'react'
import * as gitApi from '../lib/gitApi'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useLatestRef } from './useLatestRef'
import { useOnChange } from './useOnChange'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'
import type { ExclusiveGitOperationOptions } from './useRunExclusiveGitOperation'
import { isConflictedFile, isGitOperationDisabled } from '../lib/gitUtils'
import type { GitStatusResult } from '@shared/types'

const SYNC_PULL_CONFLICT_MESSAGE =
  'プルでコンフリクトが発生しました。解決してからもう一度同期してください'

// プルの結果。failed は未実行(別の操作の実行中)も含む。コンフリクトは git が失敗として返しても conflicted にする
type PullOutcome = 'success' | 'failed' | 'conflicted'

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
  /** 初回 push(pushSetUpstream)の実行中か。isPushing と同時に true になる(実行中フラグを共有する)。
   *  バナーのボタンの「push 中...」の表示に使う */
  isSettingUpstream: boolean
  /** upstream の無い現在のブランチを origin へ送り、upstream を設定する。戻り値は実際に実行され成功したか
   *  (成功の後にフォーカスをツールバーの「…」へ移すかの判定に使う) */
  pushSetUpstream: () => Promise<boolean>
  /** behind があればプルし、成功して開始時に ahead があればプッシュする。失敗・未実行・コンフリクト・
   *  フォルダの切り替えのときはプッシュしない */
  syncChanges: () => Promise<void>
  /** syncChanges の実行中か。プルとプッシュの両方の完了まで true */
  isSyncing: boolean
  /** 他の操作の実行中やマージ中で、同期を要求しても実行できない状態か。isPushBlocked と同じ理由でここに閉じる */
  isSyncBlocked: boolean
  remoteOperationError: Error | null
  /** remoteOperationError を消す。同期の失敗はステータスバーにも出るため、前のフォルダの失敗を次のフォルダへ
   *  持ち込まないために使う */
  clearRemoteOperationError: () => void
}

export function useGitRemoteOperations(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  fileLock?: FileOperationLock,
  refreshHistory?: () => Promise<void>,
  folderPath?: string | null
): GitRemoteOperationsState {
  const [isPushing, setIsPushing] = useState(false)
  const isPushingRef = useRef(false)
  const [isPulling, setIsPulling] = useState(false)
  const isPullingRef = useRef(false)
  const [isFetching, setIsFetching] = useState(false)
  const isFetchingRef = useRef(false)
  const [isSettingUpstream, setIsSettingUpstream] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const isSyncingRef = useRef(false)
  const [remoteOperationError, setRemoteOperationError] = useState<Error | null>(null)
  // 実行中にフォルダが切り替わったかを、await の後で見る(クロージャの folderPath は開始時の値のまま)
  const latestFolderPathRef = useLatestRef(folderPath)
  const clearRemoteOperationError = useCallback((): void => {
    setRemoteOperationError(null)
  }, [])
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  // fetch・pull・push・初回 push の後は、↑/↓ と履歴の上流のコミット・リモートの ref が変わるため、
  // ステータスと履歴を取り直す(refreshHistory を渡さない呼び出しではステータスだけ。差分 3)。
  // 両方の完了を待つ(allSettled): Promise.all では履歴が先に失敗した時点で実行中フラグが下り、ステータスの
  // 取り直し前の upstream 未設定の表示のまま初回 push を押せてしまう(パターン 73)。失敗はどちらも呼び出し側へ
  // 伝えない(共有ランナーと同じ。取り直しの失敗で成功を失敗にしない。パターン 52)
  const refreshAfterRemoteOperation = async (): Promise<void> => {
    await Promise.allSettled([refreshGitStatus(), refreshHistory?.()])
  }
  const runExclusiveOperation = useRunExclusiveGitOperation(
    refreshAfterRemoteOperation,
    setRemoteOperationError
  )
  // ステータスバーは常に見えるため、切り替えの後に終わった操作の結果を新しいフォルダのエラーへ反映しない。
  // 切り替えの時点の消去(useAppState の clearRemoteOperationError)の後に、前のフォルダの失敗が届く
  const runRemoteOperation = (options: ExclusiveGitOperationOptions): Promise<boolean> => {
    const startFolderPath = latestFolderPathRef.current
    return runExclusiveOperation({
      ...options,
      isResultStale: () => latestFolderPathRef.current !== startFolderPath
    })
  }
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
  // Promise<boolean> を返す設計になっている。公開の push・pull・fetchRemote は戻り値を
  // 使わないため、公開する型(Promise<void>)に合わせて捨てる(syncChanges は内部の結果を見る)
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
  // showConflictError: git が失敗として返したコンフリクトの文言を出すか。公開の pull は従来どおり出す。同期は
  // 取り直しの後に通知へ置き換えるため、間に git の文言を挟まない
  const runPull = async (showConflictError: boolean): Promise<PullOutcome> => {
    let conflicted = false
    const succeeded = await runRemoteOperation({
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
      execute: async () => {
        const result = await gitApi.pull()
        conflicted = result.conflicted
        if (showConflictError && result.errorMessage !== undefined) {
          throw new Error(result.errorMessage)
        }
      }
    })
    if (conflicted) return 'conflicted'
    return succeeded ? 'success' : 'failed'
  }

  const pull = (): Promise<void> => runPull(true).then(() => undefined)

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
  const isPushUnavailable = (): boolean =>
    isPushingRef.current || isPullingRef.current || lock.isAnyLocked() || isRemoteOperationDisabled

  const runPush = (): Promise<boolean> =>
    runRemoteOperation({
      isBusy: isPushUnavailable,
      setBusy: (busy) => {
        isPushingRef.current = busy
        setIsPushing(busy)
      },
      execute: gitApi.push
    })

  const push = (): Promise<void> => runPush().then(() => undefined)

  // 初回 push(upstream の設定)。開始条件と実行中フラグは push と共有する: push と初回 push は同じ ref と branch.<b> の設定を書くため
  // 同時に走らせず、commit・checkout の途中に古い HEAD を送らないようロック中は待つ(push のコメントと同じ理由)。
  // lockGlobal は取らない(既存の push と同じ。設計書の排他の表)。どちらの push かをバナーの表示に使うため、
  // isSettingUpstream を別に持つ。開始時(onStart)にパネル上部の前回のエラーを消す(パターン 87)
  const pushSetUpstream = (): Promise<boolean> =>
    runRemoteOperation({
      isBusy: isPushUnavailable,
      setBusy: (busy) => {
        isPushingRef.current = busy
        setIsPushing(busy)
        setIsSettingUpstream(busy)
      },
      onStart: () => setRemoteOperationError(null),
      execute: gitApi.pushSetUpstream
    })

  const ahead = gitStatus?.ahead ?? 0
  const behind = gitStatus?.behind ?? 0
  const mergeInProgress = gitStatus?.mergeInProgress ?? false

  // ahead・behind は開始時の値で決める(プルの後の取り直しで変わった値は見ない)。プルが成功しなければプッシュしない:
  // 失敗・未実行・コンフリクトの途中で送らない。プルの間にフォルダが切り替わったときも、切り替え先へ送らない。
  // コンフリクトの通知は取り直しの後に出す(未解決のファイルが見えてから出し、解決で消す)
  const syncChanges = async (): Promise<void> => {
    if (isSyncingRef.current || mergeInProgress || (ahead === 0 && behind === 0)) return
    const startFolderPath = latestFolderPathRef.current
    isSyncingRef.current = true
    setIsSyncing(true)
    try {
      const pullOutcome = behind > 0 ? await runPull(false) : 'success'
      if (latestFolderPathRef.current !== startFolderPath) return
      if (pullOutcome === 'conflicted') {
        setRemoteOperationError(new Error(SYNC_PULL_CONFLICT_MESSAGE))
      } else if (pullOutcome === 'success' && ahead > 0) {
        await runPush()
      }
    } finally {
      isSyncingRef.current = false
      setIsSyncing(false)
    }
  }

  // コンフリクトの通知は、未解決のファイルが無くなったら消す。rebase は mergeInProgress が true にならないため、
  // ファイルで判定する。未解決のファイルが見えないだけでは消さない(取り直しが反映されない間に消えないよう、
  // 有から無への変化で見る)。別のエラーに置き換わっていれば残す
  const hasConflictedFiles = gitStatus?.files.some(isConflictedFile) ?? false
  useOnChange(hasConflictedFiles, () => {
    if (hasConflictedFiles) return
    setRemoteOperationError((current) =>
      current?.message === SYNC_PULL_CONFLICT_MESSAGE ? null : current
    )
  })

  // isBusy() 内の判定(ref を見る、実行開始の可否そのもの)とは別に、レンダーに
  // 反映される state 値から「他操作起因で押せないか」を計算する。値の出所
  // (push/pull が同時実行不可、両者ともハンク操作/commit 中も不可)は isBusy()
  // と同じ業務ルールだが、ここでは UI 表示のために毎レンダー計算し直す
  const isPushBlocked = isPulling || lock.isAnyLocked()
  const isPullBlocked = isPushing || lock.isAnyLocked()
  const isSyncBlocked =
    isRemoteOperationDisabled ||
    isPulling ||
    isPushing ||
    mergeInProgress ||
    (behind > 0 && isPullBlocked) ||
    (ahead > 0 && isPushBlocked)

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
    isSettingUpstream,
    pushSetUpstream,
    syncChanges,
    isSyncing,
    isSyncBlocked,
    remoteOperationError,
    clearRemoteOperationError
  }
}
