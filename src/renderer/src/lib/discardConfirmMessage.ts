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

// ハンクの取り消しの確認文言。未保存の編集の破棄も 1 回の確認で承諾させる
export function buildDiscardHunkConfirmMessage({
  path,
  hunkHeader,
  hasUnsavedEdits
}: {
  /** リポジトリ相対パス(git status の表記) */
  path: string
  /** 対象ハンクの見出し(@@ -a,b +c,d @@ ...) */
  hunkHeader: string
  /** 対象ファイルのタブに未保存の編集があるか */
  hasUnsavedEdits: boolean
}): string {
  const base = `${path} の次のハンクを取り消しますか？この操作は元に戻せません。\n\n${hunkHeader}`
  return hasUnsavedEdits ? `${base}\n\nエディタの未保存の編集も破棄されます。` : base
}

// 変更の一括取り消しの確認文言。未保存の編集の破棄確認は confirmDiscardAnyDirty が別に行う
export function buildDiscardAllConfirmMessage({
  count,
  trashCount,
  folderCount = 0
}: {
  /** 取り消す変更(未ステージのファイル)の件数 */
  count: number
  /** そのうちゴミ箱へ移動する未追跡・intent-to-add ファイルの件数 */
  trashCount: number
  /** trashCount のうち、フォルダ(ネストした git リポジトリ。'/' で終わるパス)の件数 */
  folderCount?: number
}): string {
  const base = `変更 ${count} 件を取り消しますか？この操作は元に戻せません。`
  if (trashCount === 0) return base
  const trash = `${base}\nうち ${trashCount} 件の未追跡ファイルはゴミ箱へ移動します。`
  // ネストした git リポジトリは .git ごとフォルダ全体が移る(ファイル単位の確認文言と揃える)
  return folderCount > 0
    ? `${trash}\nうち ${folderCount} 件はフォルダ（git リポジトリ）で、フォルダとその中身がすべて移動します。`
    : trash
}
