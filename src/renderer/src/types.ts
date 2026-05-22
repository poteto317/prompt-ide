export type Panel = 'explorer' | 'source-control' | 'prompts'

export type Prompt = {
  id: string
  title: string
  content: string
  createdAt: number
}

export type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

export type OpenFile = {
  path: string
  name: string
  content: string
  language: string
}
