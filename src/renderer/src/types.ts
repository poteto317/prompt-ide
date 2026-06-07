import type { FileTreeNode } from '@shared/types'

export type {
  FileTreeNode,
  Prompt,
  Task,
  Stage,
  StageEvent,
  StageId,
  StageKind,
  StageStatus
} from '@shared/types'

export type FileNode = FileTreeNode & { type: 'file' }

export type Panel = 'explorer' | 'source-control' | 'prompts' | 'progress' | 'settings'

export type OpenFile = {
  path: string
  name: string
  content: string
  language: string
}
