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
