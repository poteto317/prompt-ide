import type { BranchOperationKind, PendingStashOperation } from '../types'

// 「Git 操作が実行中か」の判定に使う状態。各フックの実行中フラグ・ロックの状態を、呼び出し側が集めて渡す
export interface GitOperationActivity {
  /** 全体ロック・パス単位のロックのどちらかが取られているか(fileOperationLock.isAnyLocked()) */
  isAnyLocked: boolean
  isPushing: boolean
  isFetching: boolean
  isSettingUpstream: boolean
  pendingBranchOperation: BranchOperationKind | null
  stashPendingOperation: PendingStashOperation | null
  isCreatingTag: boolean
  isInitializing: boolean
  isAddingOrigin: boolean
}

// Git 操作が実行中か。clone は成功するとフォルダが切り替わるため、Git 操作の実行中は始めない(その判定に使う)。
// 全体ロックを取る操作(commit・pull・checkout・ブランチの作成・マージ・stash の push と pop・取り消し・マージの完了と
// 中止)と、パス単位のロックを取る操作(ステージ・ハンク)はロックで見る。ロックを取らない操作(push・fetch・初回 push・
// ブランチの削除・stash の削除(drop)・タグの作成・初期化・origin の追加)は実行中フラグで見る
export function isAnyGitOperationRunning(activity: GitOperationActivity): boolean {
  return (
    activity.isAnyLocked ||
    activity.isPushing ||
    activity.isFetching ||
    activity.isSettingUpstream ||
    activity.pendingBranchOperation !== null ||
    activity.stashPendingOperation !== null ||
    activity.isCreatingTag ||
    activity.isInitializing ||
    activity.isAddingOrigin
  )
}
