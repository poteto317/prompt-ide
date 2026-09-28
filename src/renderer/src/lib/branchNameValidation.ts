// ブランチ名入力ダイアログの検証(UX 用)。ここで弾くのは入力中にすぐ伝えたい3種類だけで、
// git の規則(`..`、空白、`~^:?*[\`、末尾の .lock 等)は main 側の
// git check-ref-format --branch に委ねる(セキュリティ境界も main 側)。
// 渡される name は NameInputDialog が trim 済み
export function validateBranchName(name: string, existingNames: readonly string[]): string | null {
  if (name.length === 0) return '名前を入力してください'
  if (name.startsWith('-')) return '`-` で始まる名前は使用できません'
  // 'git checkout @' は HEAD の別名として解釈され、作成後に切り替えられない
  // (main 側の createBranch の検証と対応する)
  if (name === '@') return 'この名前は使用できません'
  if (existingNames.includes(name)) return '同じ名前のブランチが既に存在します'
  return null
}
