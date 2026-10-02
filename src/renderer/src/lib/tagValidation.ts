import { getTagNameCollision, getTagNameRuleViolation, normalizeTagName } from '@shared/tagName'
import type { TagNameCollision, TagNameCollisionKind, TagNameRuleViolation } from '@shared/tagName'
import { getTagMessageRuleViolation } from '@shared/tagMessage'
import type { TagMessageRuleViolation } from '@shared/tagMessage'
import type { TagKind } from '@shared/types'

// タグの作成ダイアログの検証(UX 用)。アプリ独自の規則と、既存のタグ・ブランチとの衝突は
// main と同じ判定(@shared/tagName)を使う。git の規則(`..`、空白、末尾の .lock 等)は main 側の
// check-ref-format に委ねる(セキュリティ境界も main 側)。name は main の入口と同じ normalizeTagName
// (前後の空白を除き NFC)を通してから検証する
const RULE_VIOLATION_MESSAGES: Record<TagNameRuleViolation, string> = {
  empty: '名前を入力してください',
  'leading-dash': '`-` で始まる名前は使用できません',
  reserved: 'この名前は使用できません'
}

const COLLISION_MESSAGES: Record<TagNameCollisionKind, (collision: TagNameCollision) => string> = {
  duplicate: () => '同じ名前のタグが既に存在します',
  conflict: (collision) => `既存のタグ ${collision.with} と名前が衝突します`,
  branch: () => '同じ名前のブランチが存在するため、タグを作成できません'
}

export function validateTagName(
  name: string,
  existingTags: readonly string[],
  existingBranches: readonly string[]
): string | null {
  const normalized = normalizeTagName(name)
  const violation = getTagNameRuleViolation(normalized)
  if (violation !== null) return RULE_VIOLATION_MESSAGES[violation]
  const collision = getTagNameCollision(normalized, existingTags, existingBranches)
  return collision === null ? null : COLLISION_MESSAGES[collision.kind](collision)
}

const MESSAGE_RULE_VIOLATION_MESSAGES: Record<TagMessageRuleViolation, string> = {
  empty: 'メッセージを入力してください',
  nul: 'メッセージに使用できない文字が含まれています'
}

// 注釈付きタグのメッセージの検証。規則は main と同じ判定(@shared/tagMessage)を使う
export function validateTagMessage(kind: TagKind, message: string): string | null {
  const violation = getTagMessageRuleViolation(kind, message)
  return violation === null ? null : MESSAGE_RULE_VIOLATION_MESSAGES[violation]
}
