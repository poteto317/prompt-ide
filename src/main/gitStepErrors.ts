import { GitPluginError } from 'simple-git'

// git の呼び出しの失敗を、操作の文脈の日本語の Error にする共通の部品。リモートの管理(gitRemoteSetupService)・
// タグの作成(gitTagService)・push/pull/fetch(gitRemoteTimeout)が使う。打ち切りの判定は通信を伴わない操作
// (init・remote add・git tag)にも使うため、リモート用の gitRemoteTimeout ではなくここに置く(パターン 55)。
// 文言(接頭辞・時間切れの文言)は呼び出し側が持ち、ここは組み立てだけを担う

// simple-git の timeout プラグインが打ち切ったか(英語の固定文言 "block timeout reached" の GitPluginError を投げる)
export function isGitTimeoutError(err: unknown): boolean {
  return err instanceof GitPluginError && err.plugin === 'timeout'
}

// 失敗に添える詳細(git のメッセージ)。前後の空白・改行を除く
export function errorDetail(err: unknown): string {
  return err instanceof Error ? err.message.trim() : String(err).trim()
}

// 「接頭辞: 詳細」の失敗。詳細が空なら接頭辞だけ(末尾に「: 」を残さない)
export function failure(prefix: string, detail: string): Error {
  return new Error(detail === '' ? prefix : `${prefix}: ${detail}`)
}

// 防御の 2 層: URL の検証(@shared/remoteUrl)はパスワード入りの URL を構造的に拒否する(利用者の決定。認証は credential
// helper に任せる)。http・https・git:// の userinfo、ssh:// の `user:pw@`・`%XX`、path の `@` はアプリから追加できない。
// そのため、ここ(マスク)だけが守る入力は減り、アプリが追加した URL で残るのは scp 形式の user・ssh:// の user(パスワード
// 無しのユーザー名)と、git が出力に含める URL(端末で追加した origin への push の文言など、検証を通っていない URL を
// 含む)になる。検証の取りこぼしに備え、パスワード入りの形を伏せる処理と過剰マスクの注意はそのまま維持する

// URL の userinfo(`<scheme>://user:pass@`)。`://` の後、最初の `/`・空白・引用符までの最後の `@` まで。
// スキームは問わない(git が小文字にそろえたり、未知のスキームのまま出したりしても効く)。
// userinfo に生の `/` がある URL(`https://user:pa/ss@h/r`)は `user:pa` が残るが、`/` を越えて最後の `@` まで伏せる
// 形にすると `repository 'https://host/a@b/' not found` が `https://***@b/` になり、ホストとパスを消す(5 周目の
// レビューで確認)。その URL は検証(@shared/remoteUrl の path の `@` の拒否)が拒否するため、ここは変えない
const URL_USERINFO_PATTERN = /:\/\/[^/\s'"`]+@/g
// scp 形式の user(`user@host:path`)と、ホスト名として出た `user:pass@host`(git:// は userinfo を解釈せず、
// `unable to look up alice:s3cret@host` と出す。実機で確認)。語の先頭(行頭・空白・引用符の直後)から、語の中の
// 最後の `@`(直後が `@` でない)まで。貪欲に一致させ、パスワードに `@` を含む `u:p@ss@host`(ssh の
// `u:p@ss@127.0.0.1: Permission denied (publickey).`。3 周目のレビューで実機の sshd で確認)も `ss` を残さない。
// URL の検証は ssh:// の `user:pw@` と `%XX` を拒否するが、git は `%40` を `@` に戻して ssh に渡すため、端末で追加した
// `ssh://u:p%40ss@h/r` への push では ssh が `u:p@ss@h: …` と出す(実機 git 2.50.1 と偽の ssh で確認)。その防御として残す
// `/` を含む語(`https://host/a@b` のパス)は対象にしない。host と path は残す
const SCP_USERINFO_PATTERN = /(^|[\s'"`])[^\s/'"`]+@(?=[^@\s/'"`])/g

// 文中の URL の資格情報(userinfo)を `***` に伏せる。git の失敗のメッセージは、https の push のように資格情報を
// 取り除いて出す場合と、remote add の `could not set 'remote.origin.url' to '<url>'`(config.lock が残っていたとき)
// のように URL をそのまま出す場合がある(実機 git 2.50.1 で確認)。入力した URL の完全一致ではなく形で伏せる
// (git が整形した形にも効かせる)。パスワードの無い user@ も伏せる(トークンだけを user に置く書き方があるため)。
// 引用符を区切りとして扱うため、userinfo に引用符を含む URL(`https://u:p'ss@h/r`)ではその前の部分が残る。
// URL の検証(@shared/remoteUrl の invalid-char)が引用符を拒否するため、アプリが追加した URL はここに来ない前提
// (利用者が端末で追加した origin への初回 push の文言はこの限りでない)
export function redactCredentials(text: string): string {
  return text.replace(URL_USERINFO_PATTERN, '://***@').replace(SCP_USERINFO_PATTERN, '$1***@')
}

// git の呼び出しの失敗を、操作の文脈の日本語にする。timeout プラグインの打ち切り(英語の固定文言)は時間切れの
// 文言、それ以外は git のメッセージを添えた失敗の文言(英語の GitError をそのまま見せない。パターン 74)。
// git の出力は URL の資格情報を伏せる場合と伏せない場合があるため、利用者が入力した URL を扱う呼び出し側は
// redact(redactCredentials)を渡して詳細を伏せる。既定は詳細をそのまま添える(タグの作成など URL を扱わない操作)
export function toStepError(
  err: unknown,
  timeoutMessage: string,
  failurePrefix: string,
  redact: (detail: string) => string = (detail) => detail
): Error {
  if (isGitTimeoutError(err)) return new Error(timeoutMessage)
  return failure(failurePrefix, redact(errorDetail(err)))
}

// git の呼び出し 1 つを実行し、失敗を toError で変換して投げる。アプリ自身の検証の Error は包まない
export async function runGitStep<T>(
  run: () => Promise<T>,
  toError: (err: unknown) => Error
): Promise<T> {
  try {
    return await run()
  } catch (err) {
    throw toError(err)
  }
}
