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
