import type { FileTreeNode, GitStashEntry } from '@shared/types'

export type {
  PromptToolId,
  FileTreeNode,
  Prompt,
  Task,
  Stage,
  StageEvent,
  StageId,
  StageKind,
  StageStatus,
  HistoryEntry,
  HistoryStatus
} from '@shared/types'

export type FileNode = FileTreeNode & { type: 'file' }

export type Panel = 'explorer' | 'source-control' | 'prompts' | 'progress' | 'history' | 'settings'

export type OpenFile = {
  path: string
  name: string
  content: string
  savedContent: string
  language: string
}

// 実行中のブランチ操作の種類(useGitBranchOperations の pendingBranchOperation)。
// フックと表示側(トリガーの文言を決める lib/branchTriggerLabel 等)の双方が使うため、
// フックではなく renderer 共通の型として置く
export type BranchOperationKind = 'checkout' | 'create' | 'delete' | 'merge'

// 退避の操作の種類。pendingStashOperation(useGitStashOperations)と、各行のボタンの表示で使う
export type StashOperationKind = 'push' | 'pop' | 'drop'

// 実行中の退避操作。どの退避に対する操作かを sha で持つ(push は退避がまだ無いので null)。
// 行ごとに「押したボタンだけ」実行中の表示にするため
export type PendingStashOperation = { kind: StashOperationKind; sha: string | null }

// 「退避」セクションが受け取る状態と操作。値が多いため 1 つのオブジェクトにまとめ、
// App → Sidebar → SourceControlPanel → GitRepoView → StashSection へ 1 つの props で渡す
export interface StashPanelState {
  entries: GitStashEntry[]
  pendingOperation: PendingStashOperation | null
  error: Error | null
  onPush: (message: string) => Promise<void>
  onPop: (sha: string) => Promise<void>
  onDrop: (entry: GitStashEntry) => Promise<boolean>
}

// 「変更をすべて取り消す」が受け取る状態と操作
export interface DiscardAllState {
  /** 一括の取り消しが実行中か */
  isDiscarding: boolean
  error: Error | null
  /** 確認 → 取り消し → 成功時のタブ・ツリーの再読込 */
  onDiscardAll: () => Promise<void>
}
