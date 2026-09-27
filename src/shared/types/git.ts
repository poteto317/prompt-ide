export type GitFileStatus = {
  path: string
  index: string
  workingDir: string
  /** リネーム(index === 'R')のときの旧パス。ステージ済みリネームの diff は
   *  新パスだけを pathspec に渡すと git がリネーム検出をせず「新規ファイル」
   *  として出力してしまうため、その判定に使う */
  from?: string
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
