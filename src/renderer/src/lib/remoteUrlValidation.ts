import {
  MAX_REMOTE_URL_LENGTH,
  getRemoteUrlRuleViolation,
  normalizeRemoteUrl
} from '@shared/remoteUrl'
import type { RemoteUrlRuleViolation } from '@shared/remoteUrl'

// リモートの URL の検証(UX 用。セキュリティ境界は main 側)。リモートの追加(AddRemoteDialog)と clone
// (CloneRepositoryDialog)のダイアログで共通。規則と順序は main と共有の @shared/remoteUrl を使い、文言はここの表で
// 持つ。値は main の入口と同じ正規化を通してから検証する(パターン 83)

// main(gitRemoteUrlMessages の REMOTE_URL_RULE_MESSAGES)と同じ文言。文脈(ダイアログ内)は同じだが、
// 層ごとに表を持つ(タグ・ブランチの検証と同じ作り)
const REMOTE_URL_RULE_VIOLATION_MESSAGES: Record<RemoteUrlRuleViolation, string> = {
  empty: 'URL を入力してください',
  'too-long': `URL が長すぎます（${MAX_REMOTE_URL_LENGTH} 文字まで）`,
  'invalid-char': 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません',
  'leading-dash': '`-` で始まる URL は使用できません',
  unsupported:
    '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
}

// renderer は platform を知らないため、Windows のドライブの形は寛容側(windowsPaths: true)で通し、
// 最終判断は main が行う
export function validateRemoteUrl(url: string): string | null {
  const violation = getRemoteUrlRuleViolation(normalizeRemoteUrl(url), { windowsPaths: true })
  return violation === null ? null : REMOTE_URL_RULE_VIOLATION_MESSAGES[violation]
}
