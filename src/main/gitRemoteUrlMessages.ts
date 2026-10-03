import { MAX_REMOTE_URL_LENGTH } from '@shared/remoteUrl'
import type { RemoteUrlRuleViolation } from '@shared/remoteUrl'

// URL の規則の違反ごとの文言だけを持つ純粋なモジュール(git の呼び出しとは無関係。gitMergeMessages.ts・gitStashMessages.ts
// と同じ位置づけ)。リモートの追加(gitRemoteSetupService)と clone(gitCloneService)が使う。判定(種類と順序)は renderer と
// 同じ getRemoteUrlRuleViolation(@shared/remoteUrl)で、文言は各側の表で持つ(パターン 88)。URL は資格情報を含みうるため、
// 文言に入れない
export const REMOTE_URL_RULE_MESSAGES: Record<RemoteUrlRuleViolation, string> = {
  empty: 'URL を入力してください',
  'too-long': `URL が長すぎます（${MAX_REMOTE_URL_LENGTH} 文字まで）`,
  'invalid-char': 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません',
  'leading-dash': '`-` で始まる URL は使用できません',
  unsupported:
    '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
}
