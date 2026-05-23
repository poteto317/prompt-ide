import type { FileTreeNode } from '@shared/types'

export type { FileTreeNode }

export type FileNode = FileTreeNode & { type: 'file' }

export type Panel = 'explorer' | 'source-control' | 'prompts'

export type Prompt = {
  id: string
  title: string
  content: string
  createdAt: number
}

export type OpenFile = {
  path: string
  name: string
  content: string
  language: string
}
