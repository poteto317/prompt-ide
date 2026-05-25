import type { FileTreeNode } from '@shared/types'

export type { FileTreeNode, Prompt } from '@shared/types'

export type FileNode = FileTreeNode & { type: 'file' }

export type Panel = 'explorer' | 'source-control' | 'prompts' | 'settings'

export type OpenFile = {
  path: string
  name: string
  content: string
  language: string
}
