interface DiscardConfirmMessageOptions {
  /** リポジトリ相対パス(git status の表記) */
  path: string
  /** true ならゴミ箱への移動(未追跡・intent-to-add)、false なら index の内容への復元。
   *  判定は lib/discardTarget.ts の movesToTrashOnDiscard */
  movesToTrash: boolean
  /** 対象(未追跡ディレクトリなら配下)のタブに未保存の編集があるか */
  hasUnsavedEdits: boolean
}

// 変更の取り消しの確認文言。エディタの未保存の編集の破棄も 1 回の確認で承諾させる
// (確認を 2 回に分けると、片方だけ承諾された中途半端な状態の扱いが必要になるため)
export function buildDiscardConfirmMessage({
  path,
  movesToTrash,
  hasUnsavedEdits
}: DiscardConfirmMessageOptions): string {
  // status は untracked-files=all のため、'/' で終わるパスはネストした git リポジトリだけに
  // 現れる。移動するとその .git(未 push のコミットを含む)ごとゴミ箱へ行くため、
  // フォルダ全体が対象であることを明示する(最終レビューで追加)
  const trashMessage = path.endsWith('/')
    ? `${path} をゴミ箱へ移動しますか？フォルダとその中身がすべて移動します。`
    : `${path} をゴミ箱へ移動しますか？`
  const base = movesToTrash
    ? trashMessage
    : `${path} の変更を取り消しますか？この操作は元に戻せません。`
  return hasUnsavedEdits ? `${base}\n\nエディタの未保存の編集も破棄されます。` : base
}
