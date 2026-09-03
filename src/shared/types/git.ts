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

export type GitLogEntry = {
  hash: string
  message: string
  date: string
  authorName: string
}

export type GitBranch = {
  name: string
  current: boolean
}
