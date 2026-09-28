import { findConflictingBranchName, getBranchNameRuleViolation } from '@shared/branchName'
import type { BranchNameRuleViolation } from '@shared/branchName'

// ブランチ名入力ダイアログの検証(UX 用)。アプリ独自の規則(@shared/branchName)と、
// 既存ブランチとの重複・階層の衝突だけをここで弾く。git の規則(`..`、空白、`~^:?*[\`、末尾の
// .lock 等)は main 側の git check-ref-format --branch に委ねる(セキュリティ境界も main 側)。
// 渡される name は NameInputDialog が trim 済み
const RULE_VIOLATION_MESSAGES: Record<BranchNameRuleViolation, string> = {
  empty: '名前を入力してください',
  'leading-dash': '`-` で始まる名前は使用できません',
  'head-alias': 'この名前は使用できません'
}

export function validateBranchName(name: string, existingNames: readonly string[]): string | null {
  const violation = getBranchNameRuleViolation(name)
  if (violation !== null) return RULE_VIOLATION_MESSAGES[violation]
  if (existingNames.includes(name)) return '同じ名前のブランチが既に存在します'
  const conflicting = findConflictingBranchName(name, existingNames)
  if (conflicting !== null) return `既存のブランチ ${conflicting} と名前が衝突します`
  return null
}
