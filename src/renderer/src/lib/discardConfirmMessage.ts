interface DiscardConfirmMessageOptions {
  /** リポジトリ相対パス(git status の表記) */
  path: string
  /** 未追跡ならゴミ箱への移動、追跡済みなら index の内容への復元 */
  isUntracked: boolean
  /** 対象(未追跡ディレクトリなら配下)のタブに未保存の編集があるか */
  hasUnsavedEdits: boolean
}

// 変更の取り消しの確認文言。エディタの未保存の編集の破棄も 1 回の確認で承諾させる
// (確認を 2 回に分けると、片方だけ承諾された中途半端な状態の扱いが必要になるため)
export function buildDiscardConfirmMessage({
  path,
  isUntracked,
  hasUnsavedEdits
}: DiscardConfirmMessageOptions): string {
  const base = isUntracked
    ? `${path} をゴミ箱へ移動しますか？`
    : `${path} の変更を取り消しますか？この操作は元に戻せません。`
  return hasUnsavedEdits ? `${base}\n\nエディタの未保存の編集も破棄されます。` : base
}
