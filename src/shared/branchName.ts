// ブランチ名のうち、git 本体の規則(check-ref-format)より手前でアプリ独自に拒否する規則。
// main 側(gitService.createBranch)と renderer 側(branchNameValidation)が同じ判定を
// 使うために共有する(片方だけ規則を変えると、ダイアログは通るのに main で拒否される等の
// 食い違いが起きる)。表示する文言は文脈(ダイアログ内/エラーバナー)ごとに異なるため、
// ここでは違反の種類だけを返し、文言への変換は呼び出し側が行う
export type BranchNameRuleViolation = 'empty' | 'leading-dash' | 'head-alias'

export function getBranchNameRuleViolation(name: string): BranchNameRuleViolation | null {
  if (name.length === 0) return 'empty'
  // '-' 始まりは git 自身(check-ref-format を含む)にオプションとして解釈される
  if (name.startsWith('-')) return 'leading-dash'
  // check-ref-format --branch は '@' を通すが、`git checkout @` は HEAD の別名として
  // 解釈されるため、作成できても切り替えられないブランチになる(実機 git 2.50.1 で確認)
  if (name === '@') return 'head-alias'
  return null
}

// refs/heads 配下はディレクトリ構造で保存されるため、一方が他方の親階層になる名前
// ('main' と 'main/sub' 等)は共存できない。git は checkout -b の時点で英語のエラー
// (`cannot lock ref ...`)を出して失敗するため、main/renderer の双方で事前に弾けるよう
// 衝突する既存ブランチ名を返す(無ければ null)。完全一致の重複はここでは扱わない
export function findConflictingBranchName(
  name: string,
  existingNames: readonly string[]
): string | null {
  return (
    existingNames.find(
      (existing) => name.startsWith(`${existing}/`) || existing.startsWith(`${name}/`)
    ) ?? null
  )
}
