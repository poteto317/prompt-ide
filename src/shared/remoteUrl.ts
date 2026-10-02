// リモート(origin)の URL の規則。main(gitRemoteSetupService の addOrigin)と renderer(AddRemoteDialog の
// 検証)が同じ判定・同じ順序を使う(パターン 88)。違反の種類だけを返し、文言は各側の表で持つ。
// 許可リスト方式(パターン 21・59): git が受け付ける URL のうち、アプリが追加してよい形だけを通す。
// ext::<command>(任意のコマンドを実行する)・fd::<n>・<名前>::<address>・未知のスキームの <名前>://
// (git-remote-<名前> が起動する)は、利用者の protocol.allow の設定しだいで push 時に実行される
// (実機 git 2.50.1 で確認)。simple-git も止めないため、ここが唯一の防御になる

export const MAX_REMOTE_URL_LENGTH = 2048

export type RemoteUrlRuleViolation =
  | 'empty'
  | 'too-long'
  | 'invalid-char'
  | 'leading-dash'
  | 'unsupported'

export type RemoteUrlRuleOptions = {
  /** Windows のドライブの形(`C:\` `C:/`)を絶対パスとして許可するか。main は process.platform === 'win32'、
   *  renderer は platform を知らないため寛容側の true を渡す(最終判断は main) */
  windowsPaths: boolean
}

// 前後の空白だけを除く。NFC にはそろえない(URL の中の文字を変えると、サーバー側で別のパスになる)
export function normalizeRemoteUrl(url: string): string {
  return url.trim()
}

const NETWORK_SCHEMES = ['https', 'http', 'ssh', 'git'] as const

// 空白(\s。全角の空白・改行・タブを含む)と制御文字(C0・DEL・C1)と不可視の書式文字(Unicode の Cf: ゼロ幅の
// U+200B〜200F・双方向の制御 U+202A〜202E / U+2066〜2069・U+FEFF など)。git の remote add は改行を含む URL を
// そのまま受け付け、config に複数行の値として書く(実機で確認)。書式文字は画面に見えず、確認した URL と
// 実際に書かれる URL が食い違う(双方向の制御は表示の順序も入れ替える)ため拒否する
const INVISIBLE_PATTERN = /[\s\p{Cf}]/u

// 引用符(' " `)。git は失敗の文言で URL を引用符で囲んで出すことがある(remote add の
// `could not set 'remote.origin.url' to '<url>'`。実機 git 2.50.1 で確認)。URL の中の引用符は、資格情報を伏せる
// 処理(main の redactCredentials)の区切りと区別できず、`https://u:p'ss@h/r` は `https://u:p'***@h/r'` になって
// パスワードの一部が残る。git 自体は引用符を含む URL を受け付けるが、GitHub・GitLab などのリポジトリ名に引用符は
// 使えず、現実に要るのはローカルの絶対パス(`/repos/O'Brien/b.git` など)くらいのため、安全側に倒して拒否する
const QUOTE_PATTERN = /['"`]/

function hasInvalidChar(url: string): boolean {
  if (QUOTE_PATTERN.test(url)) return true
  for (const ch of url) {
    const code = ch.codePointAt(0) ?? 0
    if (code <= 0x1f || (code >= 0x7f && code <= 0x9f) || INVISIBLE_PATTERN.test(ch)) return true
  }
  return false
}

// 資格情報の扱い(利用者の決定): パスワード入りの URL は構造的に拒否し、認証は credential helper に任せる。
// 6 周のレビューで、userinfo(`user:pass@`)の区切り方の解釈違いで資格情報が漏れる穴が毎回見つかった(remote add の
// 失敗の文言・ssh:// の user:pw@・`@` を含むパスワード・`%XX` の decode・git:// の userinfo・引用符・userinfo の生の `/`・
// userinfo の `?` `#`)。個別に塞ぐのをやめ、許可する形を最小に定義する。authority の解析は parseNetworkUrl の 1 か所に
// まとめ、判定はそこから派生させる(判定の分散が穴の温床だった。パターン 88)

// authority の終わり。RFC 3986 と curl は最初の `/` `?` `#` で終わるとみなし、git(ssh:// と git://)は最初の `/` で
// 切る。許可する URL では両者が一致するよう、authority が `/` 以外で終わる形(`https://h#sec@h2/r`)を拒否する
const AUTHORITY_END_PATTERN = /[/?#]/

// authority の `@` より後(`host[:port]`)。host は `[IPv6]`(括弧の中は 16 進数・`:`・`.` だけ)か、`:` `@` `%` と
// 角括弧を含まない名前(reg-name・IPv4。IDN の全角も既存どおり通す)。port は数字だけ(空も可)。
// `%` を許可しない理由: git は ssh:// と git:// の URL 全体の `%XX` を元の文字に戻してから host と path を分ける
// (`ssh://alice%3Apw%40h/r` は ssh に `alice:pw@h` が渡り、`ssh://git@h%2Fx/r` は host が `h` になる。実機 git 2.50.1
// と偽の ssh で確認)。port の範囲(0・65535 超)は確かめない(git は失敗するだけで資格情報を出さない。実機で確認)。
// 空の port(`host:`)は git が既定のポートとして扱う(実機で確認)ため許可する
const HOST_PORT_PATTERN = /^(\[[0-9A-Fa-f:.]+\]|[^:@%[\]]+)(?::([0-9]*))?$/

export type NetworkScheme = (typeof NETWORK_SCHEMES)[number]

export type NetworkUrlParts = {
  scheme: NetworkScheme
  /** authority の最初の `@` より前。`@` が無ければ null */
  userinfo: string | null
  host: string
  /** `:` の後の数字(空文字もありうる)。`:` が無ければ null */
  port: string | null
  /** authority の後ろ(最初の `/` `?` `#` から末尾まで)。無ければ空文字 */
  pathAndAfter: string
}

// `<scheme>://<authority><pathAndAfter>` の構造を取り出す。スキームは小文字で完全一致。authority は最初の `/` `?` `#`
// まで、userinfo は authority の最初の `@` まで(2 個目以降の `@` は host に残り、HOST_PORT_PATTERN が拒否する)。
// host:port の形が崩れていれば null。許可するかどうかは isAllowedNetworkUrl が決める
export function parseNetworkUrl(url: string): NetworkUrlParts | null {
  const scheme = NETWORK_SCHEMES.find((name) => url.startsWith(`${name}://`))
  if (scheme === undefined) return null
  const rest = url.slice(`${scheme}://`.length)
  const end = rest.search(AUTHORITY_END_PATTERN)
  const authority = end === -1 ? rest : rest.slice(0, end)
  const pathAndAfter = end === -1 ? '' : rest.slice(end)
  const at = authority.indexOf('@')
  const userinfo = at === -1 ? null : authority.slice(0, at)
  const match = HOST_PORT_PATTERN.exec(authority.slice(at + 1))
  if (match === null) return null
  return { scheme, userinfo, host: match[1], port: match[2] ?? null, pathAndAfter }
}

// ssh:// の userinfo と scp 形式の user に許可する文字(パスワード無しのユーザー名だけ)。`:`(パスワードの区切り)・
// `%`(git が decode する)・`@` `/` `?` `#` と引用符・空白を含まない。`git`・`ec2-user`・`first.last+tag` は通る。
// 先頭の `-` は許可しない(ssh に -l... などのオプションとして渡るのを防ぐ。パターン 21)
const USER_NAME_PATTERN = /^[A-Za-z0-9._~+][A-Za-z0-9._~+-]*$/

// path(と query・fragment)の `@`。authority に `@` が無い URL で path に `@` があると、利用者が意図した userinfo
// の区切りと食い違う(`https://alice:1234/s3cret@h/r` は authority が `alice:1234` になり、port が数字のため host:port
// に見える。5・6 周目のレビュー)。git は ssh:// と git:// の `%40` も `@` に戻すため、`%40` も同じく扱う。正当な
// URL の path の `@` は稀なため、すべてのスキームで拒否する(既知の制約)
const PATH_AT_PATTERN = /@|%40/i

// ネットワークの URL として許可するか。
// - authority は `/` か末尾で終わる(`?` `#` で終わる形を拒否する)
// - path・query・fragment に `@`(`%40`)を含まない
// - host は `-` で始まらない(ssh に -oProxyCommand=... として渡るのを防ぐ。パターン 21)
// - userinfo は ssh:// のパスワード無しのユーザー名だけ。http・https・git:// は `@` があれば拒否する(user だけでも
//   トークンだけでも秘密になりうる。git:// は userinfo を解釈せず、host として失敗の文言に出す。実機で確認)
function isAllowedNetworkUrl(url: string): boolean {
  const parts = parseNetworkUrl(url)
  if (parts === null) return false
  const { scheme, userinfo, host, pathAndAfter } = parts
  if (pathAndAfter !== '' && !pathAndAfter.startsWith('/')) return false
  if (PATH_AT_PATTERN.test(pathAndAfter)) return false
  if (host.startsWith('-')) return false
  if (userinfo === null) return true
  return scheme === 'ssh' && USER_NAME_PATTERN.test(userinfo)
}

// file:// の直後が `/`(絶対パス)。file://host/... は許可しない
function isFileUrl(url: string): boolean {
  return url.startsWith('file:///')
}

// scp 形式 `<user>@<host>:<path>`。user は USER_NAME_PATTERN(パスワード無しのユーザー名だけ。`/ : @` を含まない)。
// host は `/` `:` `@` を含まず、`-` で始まらず、角括弧([::1] のような IPv6 の書き方)を含まない。path は空でない。
// user@ の無い `host:path`(ssh の設定の別名)は許可しない(利用者の決定)。scp 形式は git が `%XX` を decode しない
// (実機で確認)。path の `@` はネットワークの URL と同じく拒否する(`Ua1@Ub2:Pa3@h:r` は user `Ua1@Ub2`・パスワード `Pa3`
// のつもりでも、git は host を `Ub2`、path を `Pa3@h:r` と解釈し、パスワードが URL ごと失敗の文言に残る。開発中の探索で検出し、
// remoteUrl.test.ts の性質テストが同じ形の `g@u:p@h:r` で再現する)
const SCP_PATTERN = /^([^/:@]+)@([^/:@[\]]+):([^@]+)$/

function isScpLike(url: string): boolean {
  const match = SCP_PATTERN.exec(url)
  return match !== null && USER_NAME_PATTERN.test(match[1]) && !match[2].startsWith('-')
}

const WINDOWS_DRIVE_PATTERN = /^[A-Za-z]:[\\/]/

// 絶対パス。相対パス(../bare.git)は開いているフォルダからの相対で解決され、フォルダが変わると別の場所を
// 指すため許可しない。Windows のドライブの形は windowsPaths のときだけ(macOS で `C:/x` は scp 形式になる)
function isAbsolutePath(url: string, windowsPaths: boolean): boolean {
  return url.startsWith('/') || (windowsPaths && WINDOWS_DRIVE_PATTERN.test(url))
}

// url は normalizeRemoteUrl 済みであること。判定の順序(empty → too-long → invalid-char → leading-dash →
// unsupported)は main と renderer で共有する(片方だけ変えると、ダイアログは通るのに main で拒否される)
export function getRemoteUrlRuleViolation(
  url: string,
  options: RemoteUrlRuleOptions
): RemoteUrlRuleViolation | null {
  if (url.length === 0) return 'empty'
  if (url.length > MAX_REMOTE_URL_LENGTH) return 'too-long'
  if (hasInvalidChar(url)) return 'invalid-char'
  if (url.startsWith('-')) return 'leading-dash'
  const allowed =
    isAllowedNetworkUrl(url) ||
    isFileUrl(url) ||
    isScpLike(url) ||
    isAbsolutePath(url, options.windowsPaths)
  return allowed ? null : 'unsupported'
}
