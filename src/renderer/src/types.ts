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

// マージ中の状態(バナー)が受け取る状態と操作。App → Sidebar → SourceControlPanel へ 1 つの props で渡す
export interface MergeStatePanelState {
  /** マージ中か(MERGE_HEAD がある) */
  inProgress: boolean
  /** 未解決(コンフリクト中)のファイル数 */
  unresolvedCount: number
  /** 実行中の操作(完了 / 中止)。何も実行していなければ null */
  pendingOperation: 'complete' | 'abort' | null
  error: Error | null
  /** マージを完了できるか(マージ中で未解決が 0 件) */
  canComplete: boolean
  /** 未保存編集の破棄確認 → マージを完了 → 成功時のタブ・ツリーの再読込 */
  onComplete: () => Promise<void>
  /** 中止の確認 → 未保存編集の破棄確認 → マージを中止 → 成功時のタブ・ツリーの再読込 */
  onAbort: () => Promise<void>
}
