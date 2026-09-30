import type { FileTreeNode } from '@shared/types'

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
