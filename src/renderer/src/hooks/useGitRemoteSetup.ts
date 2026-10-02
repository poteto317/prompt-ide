import { useRef, useState } from 'react'
import type { GitStatusResult } from '@shared/types'
import * as gitApi from '../lib/gitApi'
import { isGitOperationDisabled } from '../lib/gitUtils'
import type { RemoteSetupPanelState } from '../types'
import { useFileOperationLock } from './useFileOperationLock'
import type { FileOperationLock } from './useFileOperationLock'
import { useRunExclusiveGitOperation } from './useRunExclusiveGitOperation'

// 初期化・origin の追加の状態と操作(初回 push の 5 項目は useGitRemoteOperations が持ち、useAppState で合成する)
export type GitRemoteSetupState = Omit<
  RemoteSetupPanelState,
  'isSettingUpstream' | 'isPushing' | 'isPushBlocked' | 'remoteOperationError' | 'pushSetUpstream'
>

// リポジトリの初期化と origin の追加。useGitTagOperations と同じ作り: 操作ごとの実行中フラグ(ref)で二重実行を防ぎ、
// 他の Git 操作がロックを持っている間(lock.isAnyLocked())は実行しない。どちらも作業ツリー・index・HEAD を変えないため
// lockGlobal は取らない(設計書の排他の表)。初期化は Git 管理外の間だけ呼ばれ、他の Git 操作は disabled のため
// 競合しない。追加は .git/config に 1 節足すだけで、origin が無い間は push / pull が通信できないため競合しない。
// 再取得は成功・失敗のどちらでも行い、実行中フラグは再取得の後で解除する(useRunExclusiveGitOperation。パターン 73)。
// 開始時(onStart。実行しない no-op では呼ばれない)に前回のエラーを消す(パターン 87)。
// 成功の後のフォーカスの要求は UI の振る舞いのため、ここでは持たない(SourceControlPanel の useRemoteSetupFocus)
export function useGitRemoteSetup(
  gitStatus: GitStatusResult | null,
  refreshGitStatus: () => Promise<void>,
  refreshHistory: () => Promise<void>,
  fileLock?: FileOperationLock
): GitRemoteSetupState {
  const [isInitializing, setIsInitializing] = useState(false)
  const isInitializingRef = useRef(false)
  const [initError, setInitError] = useState<Error | null>(null)
  const [isAddingOrigin, setIsAddingOrigin] = useState(false)
  const isAddingOriginRef = useRef(false)
  const [addOriginError, setAddOriginError] = useState<Error | null>(null)
  const localFileLock = useFileOperationLock()
  const lock = fileLock ?? localFileLock
  const isRepoMissing = isGitOperationDisabled(gitStatus)

  // 初期化の後は、Git 管理外の表示からリポジトリの表示へ切り替えるためにステータスを、空の履歴(ブランチ)を出すために
  // 履歴を取り直す。ファイルツリーは取り直さない(.git は走査から除外され、見た目は変わらない)。
  // 両方の完了を待つ(allSettled): Promise.all では履歴が先に失敗した時点で実行中フラグが下り、ステータスの
  // 取り直し前の Git 管理外の表示のまま「リポジトリを初期化」を押せてしまう(パターン 73)。失敗はどちらも
  // 呼び出し側へ伝えない。共有ランナーは取り直しの失敗を握りつぶすため、Promise.all のときもステータスの失敗は
  // 操作の結果を変えていなかった(取り直しの失敗で成功を失敗にしない。パターン 52)
  const refreshStatusAndHistory = async (): Promise<void> => {
    await Promise.allSettled([refreshGitStatus(), refreshHistory()])
  }
  const runInit = useRunExclusiveGitOperation(refreshStatusAndHistory, setInitError)
  // 追加は origin の有無(バナー)だけが変わるため、ステータスだけ取り直す
  const runAddOrigin = useRunExclusiveGitOperation(refreshGitStatus, setAddOriginError)

  const initRepository = (branch: string): Promise<boolean> =>
    runInit({
      isBusy: () => isInitializingRef.current || lock.isAnyLocked(),
      setBusy: (busy) => {
        isInitializingRef.current = busy
        setIsInitializing(busy)
      },
      onStart: () => setInitError(null),
      execute: () => gitApi.initRepository(branch)
    })

  const addOrigin = (url: string): Promise<boolean> =>
    runAddOrigin({
      isBusy: () => isAddingOriginRef.current || lock.isAnyLocked() || isRepoMissing,
      setBusy: (busy) => {
        isAddingOriginRef.current = busy
        setIsAddingOrigin(busy)
      },
      onStart: () => setAddOriginError(null),
      execute: () => gitApi.addOrigin(url)
    })

  const clearInitError = (): void => setInitError(null)
  const clearAddOriginError = (): void => setAddOriginError(null)

  return {
    isInitializing,
    initError,
    initRepository,
    clearInitError,
    isAddingOrigin,
    addOriginError,
    addOrigin,
    clearAddOriginError
  }
}
