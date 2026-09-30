import type { BranchOperationKind } from '../types'

export interface BranchTriggerLabel {
  text: string
  ariaLabel: string
}

// 実行中の操作ごとの表示。表示テキストとアクセシブルネームを同じ場所で決めて同期させる
// (docs/review-findings-patterns.md パターン17)
const PENDING_LABELS: Record<BranchOperationKind, BranchTriggerLabel> = {
  checkout: { text: '切り替え中...', ariaLabel: 'ブランチ切り替え中' },
  create: { text: '作成中...', ariaLabel: 'ブランチ作成中' },
  delete: { text: '削除中...', ariaLabel: 'ブランチ削除中' },
  merge: { text: 'マージ中...', ariaLabel: 'ブランチのマージ中' }
}

interface BranchTriggerState {
  pendingBranchOperation: BranchOperationKind | null
  /** 他操作中でクリックしても no-op になる状態。「実行中」ではないため表示テキストは
   *  変えず、aria-label だけで伝える */
  isBlocked: boolean
  currentBranch: string | null
}

// ブランチスイッチャーのトリガーボタンに出す文言を状態から決める(BranchSwitcher は
// これを表示するだけにし、文言の決定規則をコンポーネントから切り離す)
export function getBranchTriggerLabel({
  pendingBranchOperation,
  isBlocked,
  currentBranch
}: BranchTriggerState): BranchTriggerLabel {
  if (pendingBranchOperation !== null) return PENDING_LABELS[pendingBranchOperation]
  return {
    text: currentBranch ?? '(no branch)',
    ariaLabel: isBlocked
      ? '他の操作が完了するまでブランチを切り替えられません'
      : 'ブランチを切り替え'
  }
}
