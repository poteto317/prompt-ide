import { normalizeInitialBranchName } from '@shared/branchName'
import {
  MAX_REMOTE_URL_LENGTH,
  getRemoteUrlRuleViolation,
  normalizeRemoteUrl
} from '@shared/remoteUrl'
import type { RemoteUrlRuleViolation } from '@shared/remoteUrl'
import { validateBranchName } from './branchNameValidation'

// リポジトリの初期化・リモートの追加のダイアログの検証(UX 用。セキュリティ境界は main 側)。
// 規則と順序は main と共有の @shared/branchName・@shared/remoteUrl を使い、URL の文言はここの表で持つ
// (ブランチ名の文言は branchNameValidation の表を使う。パターン 88)。
// 値は main の入口と同じ正規化を通してから検証する(パターン 83)

// 規則違反の文言はブランチの作成ダイアログ(branchNameValidation)の表を使う(同じ層に同じ表を 2 つ持たない。
// パターン 88)。既存のブランチの一覧を空で渡すため、重複・階層の衝突の判定は働かず、規則違反の文言だけが返る。
// git の規則(HEAD・`..`・末尾の .lock 等)は main の check-ref-format に委ねる
export function validateInitialBranchName(name: string): string | null {
  return validateBranchName(normalizeInitialBranchName(name), [])
}

// main(gitRemoteSetupService の REMOTE_URL_RULE_MESSAGES)と同じ文言。文脈(ダイアログ内)は同じだが、
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
