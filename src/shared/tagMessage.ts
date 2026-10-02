import type { TagKind } from './types'

// 注釈付きタグのメッセージのうち、アプリが拒否する規則。
// main 側(gitTagService)と renderer 側(tagValidation)が同じ判定を使うために共有する
// (片方だけ規則を変えると、ダイアログは通るのに main で拒否される等の食い違いが起きる。パターン 14)。
// 文言は文脈ごとに異なるため、ここでは違反の種類だけを返す
export type TagMessageRuleViolation = 'empty' | 'nul'

export function getTagMessageRuleViolation(
  kind: TagKind,
  message: string
): TagMessageRuleViolation | null {
  // 軽量タグはメッセージを使わないため検証しない
  if (kind === 'lightweight') return null
  if (message.trim() === '') return 'empty'
  // NUL は spawn の引数に渡せない
  if (message.includes('\0')) return 'nul'
  return null
}
