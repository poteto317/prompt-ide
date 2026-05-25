export type FileTreeNode = {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileTreeNode[]
}

export type GitFileStatus = {
  path: string
  index: string
  workingDir: string
}

export type GitStatusResult = {
  isRepo: boolean
  branch: string | null
  ahead: number
  behind: number
  files: GitFileStatus[]
}

export type Prompt = {
  id: string
  title: string
  content: string
  createdAt: number
}
