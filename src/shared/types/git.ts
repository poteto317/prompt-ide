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

// 安全削除(git branch -d)の結果。未マージで削除しなかった場合を例外ではなく
// 戻り値で返す(renderer 側が git のエラーメッセージ文字列で分岐しないため)
export type DeleteBranchResult = { deleted: true } | { deleted: false; reason: 'not-fully-merged' }

// 退避(git stash)の 1 件。番号(stash@{n})は他の操作で別の退避を指すようになるため、
// 識別には退避コミットの SHA を使う
export type GitStashEntry = {
  sha: string
  /** 表示用のメッセージ。メッセージ無しの退避では最後のコミットの件名。空のこともある */
  message: string
  /** 退避したブランチ名。detached HEAD では '(no branch)'。件名から取れなければ空文字 */
  branch: string
  /** 退避した日時(ISO 8601) */
  createdAt: string
}

// 一括の取り消しの結果。成功は done。途中で失敗したとき、1 件以上取り消し済み(作業ツリーが変わった)なら
// 例外ではなく partial で返す: renderer は例外のとき開いているタブ・ツリーを再読込しないため、取り消し済みの
// ファイルを古いタブが上書きして変更を戻してしまう(パターン52)。1 件目で失敗した場合と、件数の不一致・
// 分類での拒否(何も変えていない)は従来どおり例外。cause は IPC を渡れないので含めない
export type DiscardAllResult = { status: 'done' } | { status: 'partial'; message: string }

// 退避の復元(git stash pop 相当)の結果。事前検証の失敗と、巻き戻しに成功した apply 失敗は例外で返す
// (作業ツリーは変わっていない)。作業ツリーが変わったうえで警告が要る場合だけ、例外ではなく結果で返す:
// renderer は例外のとき開いているタブを再読込しないため、結果で返さないと変更後のディスクを
// 古いタブが上書きする。cause は IPC を渡れないので含めない
export type StashPopResult =
  | { status: 'restored' }
  | {
      /** 復元は済んだが、一覧から削除できなかった */
      status: 'dropFailed'
      message: string
    }
  | {
      /** 復元に失敗し、巻き戻しにも失敗した(途中の変更が残っているおそれ) */
      status: 'rollbackFailed'
      message: string
    }
