import { describe, it, expect } from 'vitest'
import {
  MAX_REMOTE_URL_LENGTH,
  getRemoteUrlRuleViolation,
  normalizeRemoteUrl,
  parseNetworkUrl
} from '../remoteUrl'

const posix = { windowsPaths: false }
const windows = { windowsPaths: true }

// main(gitRemoteSetupService の addOrigin)と renderer(AddRemoteDialog)が同じ判定・同じ順序を使う(パターン 88)。
// 許可リスト方式(パターン 21・59)。simple-git は ext:: も --upload-pack=... も止めない(実機で確認)ため、
// この判定が唯一の防御になる
describe('getRemoteUrlRuleViolation', () => {
  it.each([
    'https://github.com/a/b.git',
    'http://example.com/a.git',
    'https://host',
    'https://host/r.git',
    'https://host:8443/r',
    'https://[::1]/r',
    'ssh://git@host:22/a.git',
    'ssh://host/a.git',
    'ssh://host/r',
    'ssh://git@host/r',
    'ssh://git@host:22/r',
    // ssh:// の userinfo はパスワードの無いユーザー名だけ(`[A-Za-z0-9._~+-]+`)
    'ssh://first.last+tag@host/r',
    'ssh://ec2-user@host/r',
    'ssh://git@[::1]:22/r',
    'git://host/a',
    'git://host/r',
    'git://host:9418/r',
    'git://127.0.0.1:19418/a',
    // path の %XX(@ 以外)と query はそのまま許可する
    'ssh://git@h/a%2Fb',
    'ssh://h/a%2Fb?x=%2F',
    'https://h/r?x=1#frag',
    'file:///abs/bare.git',
    'file:///abs/x',
    'git@github.com:a/b.git',
    'user@host:path/to/repo.git',
    'ec2-user@host:path',
    'first.last@h:p',
    '/abs/bare.git',
    '/abs/x',
    '/abs/日本語/bare.git',
    // 制御文字(DEL)の直前の ~ は許可する
    'https://h/~user/a.git'
  ])('%s は許可する', (url) => {
    expect(getRemoteUrlRuleViolation(url, posix)).toBeNull()
    expect(getRemoteUrlRuleViolation(url, windows)).toBeNull()
  })

  // macOS で `C:/x` は git に scp 形式として解釈されるため、Windows のときだけ許可する
  it.each(['C:\\repos\\bare.git', 'C:/repos/bare.git', 'd:/x'])(
    'Windows のドライブの形 %s は windowsPaths のときだけ許可する',
    (url) => {
      expect(getRemoteUrlRuleViolation(url, windows)).toBeNull()
      expect(getRemoteUrlRuleViolation(url, posix)).toBe('unsupported')
    }
  )

  it('空文字は empty', () => {
    expect(getRemoteUrlRuleViolation('', posix)).toBe('empty')
  })

  it('最大長は 2048 文字で、ちょうどなら許可し、超えると too-long', () => {
    expect(MAX_REMOTE_URL_LENGTH).toBe(2048)
    const prefix = 'https://h/'
    const atLimit = prefix + 'a'.repeat(MAX_REMOTE_URL_LENGTH - prefix.length)
    expect(atLimit).toHaveLength(2048)
    expect(getRemoteUrlRuleViolation(atLimit, posix)).toBeNull()
    expect(getRemoteUrlRuleViolation(`${atLimit}a`, posix)).toBe('too-long')
  })

  // git の remote add は改行を含む URL をそのまま受け付け、config に複数行の値として書く(実機で確認)
  it.each([
    ['途中の空白', 'https://h/a b'],
    ['改行', '/a\n/b'],
    ['CR', '/a\r/b'],
    ['タブ', '/a\tb'],
    ['NUL', '/a\u0000b'],
    ['DEL', '/a\u007fb'],
    ['C1 制御文字', '/a\u0085b'],
    // 制御文字の範囲の境界値(C0 の先頭・末尾、C1 の先頭・末尾)
    ['U+0001', '/a\u0001b'],
    ['U+001F', '/a\u001fb'],
    ['U+0080', '/a\u0080b'],
    ['U+009F', '/a\u009fb'],
    ['全角の空白', '/a\u3000b'],
    // 不可視の書式文字(Unicode の Cf)。画面に見えず、確認した URL と書かれる URL が食い違う
    ['ゼロ幅スペース U+200B', 'https://h/a\u200bb'],
    ['右から左のマーク U+200F', 'https://h/a\u200fb'],
    ['双方向の上書き U+202E', 'https://h/a\u202eb'],
    ['双方向の分離 U+2066', 'https://h/a\u2066b'],
    ['双方向の分離の終わり U+2069', 'https://h/a\u2069b'],
    ['途中の BOM U+FEFF', '/a\ufeffb'],
    ['ソフトハイフン U+00AD', '/a\u00adb'],
    ['ext:: とコマンド', 'ext::sh -c touch% /tmp/x'],
    // 引用符。git は失敗の文言で URL を `'...'` で囲んで出すことがあり(remote add の `could not set
    // 'remote.origin.url' to '<url>'`)、URL の中の引用符は資格情報を伏せる処理(redactCredentials)の区切りと
    // 区別できない(パスワードの一部が残る)。git は引用符を含む URL を受け付けるが、アプリでは追加させない
    ["パスワードの '", "https://u:p'ss@h/r"],
    ['パスワードの "', 'https://u:p"ss@h/r'],
    ['パスワードの `', 'https://u:p`ss@h/r'],
    ["パスの '", "https://github.com/a/it's.git"],
    ["絶対パスの '", "/repos/O'Brien/b.git"],
    ['scp 形式の "', 'git@host:a"b.git']
  ])('%s を含むと invalid-char', (_label, url) => {
    expect(getRemoteUrlRuleViolation(url, posix)).toBe('invalid-char')
  })

  it.each(['-x', '--upload-pack=x', '-oProxyCommand=x'])('%s は leading-dash', (url) => {
    expect(getRemoteUrlRuleViolation(url, posix)).toBe('leading-dash')
  })

  it.each([
    ['ext:: の helper', 'ext::sh'],
    ['fd::', 'fd::3'],
    ['<名前>::<address>', 'foo::bar'],
    ['大文字のスキーム', 'HTTPS://github.com/a/b.git'],
    ['未知のスキーム', 'unknown://x'],
    ['ホストが - で始まる', 'ssh://-oProxyCommand=x/a'],
    ['user の後のホストが - で始まる', 'ssh://git@-oProxyCommand=x/a'],
    ['user が - で始まる', 'ssh://-l@host/a'],
    // ホストは最後の `@` の後(最初の `@` の後で切ると `b@-x` になり、- 始まりを見逃す)
    ['@ が 2 つあり最後の @ の後が - で始まる', 'ssh://a@b@-x/r'],
    ['ホストが空', 'https:///a'],
    ['user の後のホストが空', 'https://user@/a'],
    ['file:// の後がホスト', 'file://host/a'],
    ['相対パス(../)', '../bare.git'],
    ['相対パス(./)', './bare.git'],
    ['user@ の無い host:path', 'host:path'],
    ['scp のホストが - で始まる', 'git@-x:a'],
    ['scp の角括弧のホスト', '[::1]:a'],
    ['scp の角括弧のホスト(user あり)', 'git@[::1]:a'],
    ['scp の角括弧のホスト(コロンなし)', 'git@[host]:a'],
    ['scp の path が空', 'git@host:'],
    ['scp の user が空', '@host:a'],
    // git:// には認証が無く、git は `user:pass@host` 全体をホスト名として扱い、失敗の文言に資格情報を出す
    // (`unable to look up alice:s3cret@127.0.0.1:19418`。実機 git 2.50.1 で確認)。user だけでも同じ
    ['git:// の user:pass', 'git://alice:s3cret@127.0.0.1:19418/b.git'],
    ['git:// の user', 'git://alice@host/a'],
    ['git:// の空の user', 'git://@host/a'],
    // authority の `@` は 1 個まで。`ssh://u:p@ss@h/r` は ssh が `u:p@ss@h: Permission denied` と出し、
    // 資格情報を伏せる処理と区別しにくい(3 周目のレビュー。パスワードの `@` は `%40` と書く)
    ['ssh の authority に @ が 2 個', 'ssh://u:p@ss@h/r'],
    ['https の authority に @ が 2 個', 'https://u:p@ss@h/r'],
    ['http の authority に @ が 3 個', 'http://a@b@c@h/r'],
    ['パスの無い URL の authority に @ が 2 個', 'https://u:p@ss@h']
  ])('%s(%s)は unsupported', (_label, url) => {
    expect(getRemoteUrlRuleViolation(url, posix)).toBe('unsupported')
    expect(getRemoteUrlRuleViolation(url, windows)).toBe('unsupported')
  })

  // 資格情報の扱い(利用者の決定): パスワード入りの URL は構造的に拒否し、認証は credential helper に任せる。
  // 6 周のレビューで、userinfo(`user:pass@`)の区切り方の解釈違いで漏れる穴が毎回見つかった(remote add の失敗の
  // 文言・ssh:// の user:pw@・`@` を含むパスワード・`%XX` の decode・git:// の userinfo・引用符・userinfo の生の `/`・
  // userinfo の `?` `#`)。許可する形を最小に定義する。拒否の文言は既存の unsupported のまま
  describe('資格情報を含みうる URL(パスワード入りの URL を拒否する)', () => {
    it.each([
      // http・https・git:// は authority に `@` があれば拒否する(user だけでもトークンだけでも秘密になりうる)
      ['https の user', 'https://user@h/r'],
      ['https の user:pw', 'https://user:pw@h/r'],
      ['https のトークンだけ', 'https://ghp_tok@h/r'],
      ['https の user:token', 'https://alice:ghp_TOKEN@github.com/a/b.git'],
      ['https のパスの無い user:pw', 'https://user:pw@host'],
      ['https の %40 を含むパスワード', 'https://u:p%40ss@h/'],
      ['https の %2F を含むパスワード', 'https://alice:s3cr%2Fet@h/r'],
      ['https の user:pw と port', 'https://user:pw@host:443/r'],
      ['http の user', 'http://u@h'],
      ['http の user(パスあり)', 'http://alice@example.com/a.git'],
      ['http の %20 を含むパスワード', 'http://u:p%20ss@h/r'],
      ['git:// の user', 'git://u@h'],
      // ssh:// は userinfo に `:`(パスワードの区切り)があれば拒否する
      ['ssh の user:pw', 'ssh://u:pw@h/r'],
      ['ssh の user:pw(パスあり)', 'ssh://alice:pw@host/a.git'],
      ['ssh の空のパスワード', 'ssh://u:@h/r'],
      ['ssh の %40 を含むパスワード', 'ssh://u:p%40ss@h/r'],
      // ssh:// の userinfo の `%XX` は拒否する(git は URL 全体の `%XX` を元の文字に戻してから ssh に渡す)
      ['ssh の user の %40', 'ssh://u%40x@h/r'],
      ['ssh の user の %2F', 'ssh://al%2Fice@h/r'],
      // 以前は decode した結果で判定し、%40 %3A %25・二重エンコードを許可していた。`%` を含む userinfo はすべて拒否する
      ['ssh の %3A を含むパスワード', 'ssh://u:p%3Ass@h/r'],
      ['ssh の %25 を含むパスワード', 'ssh://u:p%25ss@h/r'],
      ['ssh の二重エンコード', 'ssh://u:p%252Fss@h/r'],
      ['ssh の UTF-8 のエンコード', 'ssh://u:p%C3%A9ss@h/r'],
      ['ssh の %2F を含むパスワード', 'ssh://alice:s3cr%2Fet@nohost.invalid/r'],
      ['ssh の %5C を含むパスワード', 'ssh://u:p%5Css@h/r'],
      ['ssh の %0A を含むパスワード', 'ssh://u:p%0Ass@h/r'],
      ['ssh の %27 を含むパスワード', 'ssh://u:p%27ss@h/r'],
      ['ssh の不正なエンコード', 'ssh://u:p%G1ss@h/r'],
      ['ssh の空の user', 'ssh://@h/r'],
      ['ssh の user の記号', 'ssh://u!x@h/r'],
      // userinfo に生の `/` を含む形。authority を最初の `/` で切ると `alice:1234`(`@` 無し)になり、port が数字の
      // ため host:port に見える(5・6 周目のレビュー)。path の `@` を拒否して塞ぐ
      ['https のパスワードが数字で始まる生の /', 'https://alice:1234/s3cret@h/r'],
      ['https の空のパスワードの後の生の /', 'https://alice:/s3cret@h/r'],
      ['https のトークンの生の /', 'https://ghp_tok/en@h/r'],
      ['ssh のパスワードが数字で始まる生の /', 'ssh://alice:1234/s3cret@h/r'],
      ['ssh の空のパスワードの後の生の /', 'ssh://alice:/s3cret@h/r'],
      ['ssh のトークンの生の /', 'ssh://ghp_tok/en@h/r'],
      ['git:// のパスワードが数字で始まる生の /', 'git://alice:1234/s3cret@h/r'],
      ['git:// の空のパスワードの後の生の /', 'git://alice:/s3cret@h/r'],
      ['git:// のトークンの生の /', 'git://ghp_tok/en@h/r'],
      ['http のパスワードが数字で始まる生の /', 'http://alice:1234/s3cret@h/r'],
      // authority は最初の `/` `?` `#` まで。`/` 以外で終わる authority は拒否する(境界のずらしを根絶する)
      ['https の authority の後の #', 'https://h#sec@h2/r'],
      ['https の authority の後の ?', 'https://h?x@h2/r'],
      ['ssh の authority の後の #', 'ssh://h#x@y/r'],
      ['ssh の authority の後の ?', 'ssh://h?x@y/r'],
      ['https の authority の後の #(@ 無し)', 'https://h#frag'],
      // path の `@`(既知の制約。`%40` も git が `@` に戻すため同じく拒否する)
      ['https の path の @', 'https://host/a@b'],
      ['https の path の @ が 2 個', 'https://h/a@b@c'],
      ['ssh の path の @', 'ssh://h/a@b'],
      ['ssh の user ありの path の @', 'ssh://git@host/a@b'],
      ['ssh の path の %40', 'ssh://h/a%40b'],
      ['https の path の小文字の %40', 'https://h/a%40b'],
      ['query の @', 'https://h/r?x=a@b'],
      ['fragment の @', 'https://h/r#a@b'],
      // authority の `%XX` は拒否する。git は ssh:// と git:// の URL 全体を decode してから host と path を分ける
      // (`ssh://alice%3Apw%40h/r` は ssh に `alice:pw@h` が渡り、`ssh://git@h%2Fx/r` は host が `h` になる。
      // 実機 git 2.50.1 と偽の ssh で確認)
      ['ssh の host の %3A %40', 'ssh://alice%3Apw%40h/r'],
      ['ssh の host の %2F', 'ssh://h%2Fx/r'],
      ['ssh の user ありの host の %2F', 'ssh://git@h%2Fx/r'],
      ['git:// の host の %40', 'git://alice%3Apw%40h/r'],
      ['https の host の %40', 'https://alice%3Apw%40h/r'],
      // scp 形式の user は `[A-Za-z0-9._~+-]+` だけ
      ['scp の user の記号', 'u!x@h:p'],
      ['scp の user の %', 'u%40x@h:p'],
      // scp 形式の path の `@`。`Ua1@Ub2:Pa3@h:r`(user `Ua1@Ub2`・パスワード `Pa3` のつもり)は git が host を `Ub2`、
      // path を `Pa3@h:r` と解釈し、パスワードが URL ごと失敗の文言に残る(開発中の探索で検出。末尾の性質テストが同じ形の
      // `g@u:p@h:r` で再現する)。ネットワークの URL と同じく拒否する
      ['scp の path の @', 'git@host:a@b'],
      ['scp の user:pw のつもりの @', 'Ua1@Ub2:Pa3@h.example:a/b.git'],
      ['scp の user:pw', 'alice:pw@host:a.git']
    ])('%s(%s)は unsupported', (_label, url) => {
      expect(getRemoteUrlRuleViolation(url, posix)).toBe('unsupported')
      expect(getRemoteUrlRuleViolation(url, windows)).toBe('unsupported')
    })
  })

  // 実在のホスティングサービスが「Clone」で出す URL の代表(7 周目のレビュー)。Azure DevOps の https は userinfo に
  // 組織名(`org@`)が入るため拒否し、`org@` を外した形は許可する(認証は credential helper。設計書の既知の制約)
  describe('実在のホスティングサービスの URL', () => {
    it.each([
      [
        'Azure DevOps の Clone の https(org@ 入り)',
        'https://org@dev.azure.com/org/proj/_git/repo',
        'unsupported'
      ],
      ['Azure DevOps の https(org@ を外した形)', 'https://dev.azure.com/org/proj/_git/repo', null],
      ['Azure DevOps の ssh(scp 形式)', 'git@ssh.dev.azure.com:v3/org/proj/repo', null],
      ['GitHub の https', 'https://github.com/owner/repo.git', null],
      ['GitHub の ssh(scp 形式)', 'git@github.com:owner/repo.git', null],
      ['GitHub の ssh://', 'ssh://git@github.com/owner/repo.git', null],
      ['GitLab の https', 'https://gitlab.com/group/subgroup/repo.git', null],
      ['GitLab の ssh(scp 形式)', 'git@gitlab.com:group/subgroup/repo.git', null],
      ['Bitbucket の https', 'https://bitbucket.org/workspace/repo.git', null],
      [
        'Bitbucket の Clone の https(user@ 入り)',
        'https://alice@bitbucket.org/workspace/repo.git',
        'unsupported'
      ],
      ['CodeCommit の https', 'https://git-codecommit.us-east-1.amazonaws.com/v1/repos/repo', null],
      ['CodeCommit の ssh://', 'ssh://git-codecommit.us-east-1.amazonaws.com/v1/repos/repo', null]
    ])('%s: %s → %s', (_label, url, expected) => {
      expect(getRemoteUrlRuleViolation(url, posix)).toBe(expected)
      expect(getRemoteUrlRuleViolation(url, windows)).toBe(expected)
    })
  })

  // authority の構造(`[userinfo@]host[:port]`。host は reg-name・IPv4・`[IPv6]`、port は数字だけ)
  describe('authority の構造(host と port)', () => {
    it.each([
      ['https の userinfo に生の /', 'https://user:pa/ss@nohost.invalid/r'],
      ['ssh の userinfo に生の /', 'ssh://user:pa/ss@nohost.invalid/r'],
      ['git:// の userinfo に生の /', 'git://user:pa/ss@nohost.invalid/r'],
      ['http の userinfo に生の /', 'http://u:p/ss@h/r'],
      ['ポートが数字でない', 'https://host:abc/r'],
      ['ポートが数字と文字の混在', 'https://host:22x/r'],
      ['userinfo の後のポートが数字でない', 'ssh://git@host:pw/r'],
      ['ポートの区切りが 2 つ', 'https://host:1:2/r'],
      ['IPv6 の閉じ括弧の後が : でない', 'https://[::1]x/r'],
      ['IPv6 の閉じ括弧が無い', 'https://[::1/r'],
      ['IPv6 の括弧の中が 16 進数でない', 'ssh://[-oProxyCommand=x]/r'],
      ['IPv6 の後のポートが数字でない', 'ssh://git@[::1]:pw/r'],
      ['括弧が host の途中', 'https://h[::1]/r']
    ])('%s(%s)は unsupported', (_label, url) => {
      expect(getRemoteUrlRuleViolation(url, posix)).toBe('unsupported')
      expect(getRemoteUrlRuleViolation(url, windows)).toBe('unsupported')
    })

    // port の範囲(0・65535 超)は確かめない。git は範囲外のポートで失敗するだけで、資格情報を出さない
    // (`URL rejected: Port number was not a decimal number between 0 and 65535`。実機で確認)。空の port(`host:`)は
    // git が既定のポートとして扱う(https・ssh・git:// とも、実機で確認)ため許可する
    it.each([
      'https://host:8443/x',
      'ssh://git@host:22/a',
      'ssh://git@[::1]:22/r',
      'https://[::1]/r',
      'https://[2001:db8::1]:443/r',
      'https://host/',
      'git://host:9418/x',
      'https://my-host.example-1.com/r',
      'https://192.168.0.1:8080/r',
      'https://ｇｉｔ.例え.jp/r',
      'https://host:/r',
      'git://host:/r',
      'https://host:99999/r',
      'https://host:0/r'
    ])('%s は許可する', (url) => {
      expect(getRemoteUrlRuleViolation(url, posix)).toBeNull()
      expect(getRemoteUrlRuleViolation(url, windows)).toBeNull()
    })
  })

  describe('判定の順序(empty → too-long → invalid-char → leading-dash → unsupported)', () => {
    it('長すぎて空白も含むなら too-long', () => {
      expect(getRemoteUrlRuleViolation(`${'a'.repeat(MAX_REMOTE_URL_LENGTH)} `, posix)).toBe(
        'too-long'
      )
    })

    it('- で始まり空白も含むなら invalid-char', () => {
      expect(getRemoteUrlRuleViolation('-x y', posix)).toBe('invalid-char')
    })

    it('- で始まり引用符も含むなら invalid-char', () => {
      expect(getRemoteUrlRuleViolation("-x'", posix)).toBe('invalid-char')
    })

    it('- で始まる未知の形式は leading-dash', () => {
      expect(getRemoteUrlRuleViolation('-ext::sh', posix)).toBe('leading-dash')
    })
  })
})

// authority の解析は parseNetworkUrl の 1 か所。判定(getRemoteUrlRuleViolation)はここから派生する(パターン 88)
describe('parseNetworkUrl', () => {
  it.each([
    [
      'ssh://git@host:22/a.git',
      { scheme: 'ssh', userinfo: 'git', host: 'host', port: '22', pathAndAfter: '/a.git' }
    ],
    [
      'https://host',
      { scheme: 'https', userinfo: null, host: 'host', port: null, pathAndAfter: '' }
    ],
    [
      'https://[::1]:/r?x#y',
      { scheme: 'https', userinfo: null, host: '[::1]', port: '', pathAndAfter: '/r?x#y' }
    ],
    // authority は最初の `/` で終わる(userinfo に生の `/` があると、`alice:1234` が host:port になる)
    [
      'https://alice:1234/s3cret@h/r',
      { scheme: 'https', userinfo: null, host: 'alice', port: '1234', pathAndAfter: '/s3cret@h/r' }
    ],
    // authority は最初の `#` `?` でも終わる(curl・RFC 3986 と同じ)
    [
      'https://h#sec@h2/r',
      { scheme: 'https', userinfo: null, host: 'h', port: null, pathAndAfter: '#sec@h2/r' }
    ],
    ['git://u:p@h/r', { scheme: 'git', userinfo: 'u:p', host: 'h', port: null, pathAndAfter: '/r' }]
  ])('%s を分解する', (url, parts) => {
    expect(parseNetworkUrl(url)).toEqual(parts)
  })

  it.each([
    ['ネットワークのスキームでない', 'file:///a'],
    ['大文字のスキーム', 'HTTPS://h/r'],
    ['scp 形式', 'git@h:a'],
    ['authority の @ が 2 個', 'ssh://a@b@h/r'],
    ['host の %', 'ssh://h%2Fx/r'],
    ['host が空', 'https:///a'],
    ['port が数字でない', 'https://h:x/r']
  ])('%s(%s)は null', (_label, url) => {
    expect(parseNetworkUrl(url)).toBeNull()
  })
})

describe('normalizeRemoteUrl', () => {
  it('前後の空白・改行だけを除く', () => {
    expect(normalizeRemoteUrl('  https://h/a \n')).toBe('https://h/a')
  })

  // URL の中の文字を変えると、サーバー側で別のパスになるため NFC にはそろえない
  it('NFD は NFD のまま返す', () => {
    expect(normalizeRemoteUrl('/r/e\u0301')).toBe('/r/e\u0301')
  })
})

// 性質テスト(パターン 59): スキーム(https・http・ssh・git)・scp 形式・file://・絶対パス・Windows のドライブの形に、区切り
// (`@ : / ? # %40 %3A %2F`)を挟んだ断片を掛けた URL を決定的に作り(乱数は使わない)、検証を通った URL について 2 種類の
// 性質を確かめる。
// (1) git の解釈で分解しても、userinfo に `:`(パスワードの区切り)が無い。git の解釈:
//   - ssh:// などのスキーム付き: git は URL 全体の `%XX` を元の文字に戻してから、最初の `/` までを authority とする。userinfo は
//     authority の最後の `@` より前(ssh は最後の `@` で user と host を分ける。安全側に最後の `@` を使う)
//   - scp 形式: 最後の `:` より前の最後の `@` で userinfo と host を分ける(`Ua1@Ub2:Pa3@h:r` を user `Ua1@Ub2`・パスワード
//     `Pa3` と読む利用者の意図。git は最初の `:` で host を切るため、パスワードが path に入って失敗の文言に残る)
//   - file://・絶対パス・Windows のドライブの形: ローカルのパスで、userinfo は無い
// (2) 「パスワード入りの URL を構造的に拒否する」方針(利用者の決定)の不変条件。(1) だけでは、解釈のずれを生む形
//   (authority が `#` で終わる・path の `@`)や、パスワードの無い userinfo を許す変更を検出できないため、方針そのものを検査する:
//   - スキーム付きの authority(最初の `/` `?` `#` まで)は `/` か末尾で終わる(curl・RFC 3986 と git の authority を一致させる)
//   - http・https・git:// の authority(git の解釈。最初の `/` まで)に `@` も `%40` も無い(user だけ・トークンだけも拒否する)
//   - スキーム付きの path・query・fragment に `@` も `%40` も無い。scp 形式の path(最初の `:` の後)に `@` が無い
//   - ssh:// と scp 形式の userinfo は、パスワード無しのユーザー名の文字種(`[A-Za-z0-9._~+-]`、先頭は `-` でない)だけ
describe('getRemoteUrlRuleViolation の性質: 通った URL にパスワードが入らない', () => {
  const SEPARATORS = ['', '@', ':', '/', '?', '#', '%40', '%3A', '%2F']
  // `g@` は scp 形式の user の後ろに断片を足す形(`g@u:p@h:r` が `Ua1@Ub2:Pa3@h:r` と同じ形になる)。`C:/` `C:\` は
  // Windows のドライブの形(windowsPaths のときだけ絶対パスとして通る)
  const PREFIXES = [
    'https://',
    'http://',
    'ssh://',
    'git://',
    'file:///',
    '/',
    'C:/',
    'C:\\',
    '',
    'g@'
  ]
  const urls = PREFIXES.flatMap((prefix) =>
    SEPARATORS.flatMap((s1) =>
      SEPARATORS.flatMap((s2) => SEPARATORS.map((s3) => `${prefix}u${s1}p${s2}h${s3}r`))
    )
  )

  const decodePercent = (text: string): string =>
    text.replace(/%([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16)))

  const SCHEME_PATTERN = /^(https|http|ssh|git):\/\//
  const isLocal = (url: string): boolean =>
    url.startsWith('file://') || url.startsWith('/') || /^[A-Za-z]:[\\/]/.test(url)

  // git の解釈での userinfo(無ければ null)
  function gitUserinfo(url: string): string | null {
    const scheme = SCHEME_PATTERN.exec(url)
    if (scheme !== null) {
      const rest = decodePercent(url.slice(scheme[0].length))
      const slash = rest.indexOf('/')
      const authority = slash === -1 ? rest : rest.slice(0, slash)
      const at = authority.lastIndexOf('@')
      return at === -1 ? null : authority.slice(0, at)
    }
    if (isLocal(url)) return null
    const colon = url.lastIndexOf(':')
    const beforeColon = colon === -1 ? url : url.slice(0, colon)
    const at = beforeColon.lastIndexOf('@')
    return at === -1 ? null : beforeColon.slice(0, at)
  }

  const AT_PATTERN = /@|%40/i
  const USER_NAME = /^[A-Za-z0-9._~+][A-Za-z0-9._~+-]*$/

  // 方針の不変条件のうち、破っているものの名前(破っていなければ空)
  function policyViolations(url: string): string[] {
    const violations: string[] = []
    const scheme = SCHEME_PATTERN.exec(url)
    if (scheme !== null) {
      const rest = url.slice(scheme[0].length)
      const end = rest.search(/[/?#]/)
      if (end !== -1 && rest[end] !== '/') violations.push('authority が / 以外で終わる')
      const slash = rest.indexOf('/')
      const gitAuthority = slash === -1 ? rest : rest.slice(0, slash)
      if (scheme[1] !== 'ssh' && AT_PATTERN.test(gitAuthority)) {
        violations.push('http・https・git:// の authority の @')
      }
      if (end !== -1 && AT_PATTERN.test(rest.slice(end)))
        violations.push('path・query・fragment の @')
    } else if (!isLocal(url)) {
      const colon = url.indexOf(':')
      if (colon !== -1 && url.slice(colon + 1).includes('@')) violations.push('scp の path の @')
    }
    const userinfo = gitUserinfo(url)
    if (userinfo !== null && !USER_NAME.test(userinfo)) violations.push('userinfo の文字種')
    return violations
  }

  const passedPosix = urls.filter((url) => getRemoteUrlRuleViolation(url, posix) === null)
  const passedWindows = urls.filter((url) => getRemoteUrlRuleViolation(url, windows) === null)
  const passed = [...passedPosix, ...passedWindows]
  const isDrive = (url: string): boolean => /^[A-Za-z]:[\\/]/.test(url)

  it('組み合わせが空にならず、scp 形式・ssh:// の user あり・userinfo 無し・ドライブの形の各形が通る', () => {
    expect(urls.length).toBe(PREFIXES.length * SEPARATORS.length ** 3)
    expect(passedPosix.length).toBeGreaterThan(0)
    expect(passed.some((url) => !url.includes('://') && !isLocal(url) && url.includes('@'))).toBe(
      true
    )
    expect(passed.some((url) => url.startsWith('ssh://') && gitUserinfo(url) !== null)).toBe(true)
    expect(passed.some((url) => url.includes('://') && gitUserinfo(url) === null)).toBe(true)
    // windows の経路(ドライブの形)を実際に通す。posix ではドライブの形は通らない
    expect(passedWindows.some((url) => url.startsWith('C:/'))).toBe(true)
    expect(passedWindows.some((url) => url.startsWith('C:\\'))).toBe(true)
    expect(passedPosix.some(isDrive)).toBe(false)
    expect(passedWindows.length).toBeGreaterThan(passedPosix.length)
  })

  it('検証を通った URL は、git の解釈で分解しても userinfo に : を含まない', () => {
    const leaked = passed.filter((url) => gitUserinfo(url)?.includes(':') === true)
    expect(leaked).toEqual([])
  })

  it('検証を通った URL は、パスワード入りの URL を拒否する方針の不変条件を満たす', () => {
    const broken = passed
      .map((url) => ({ url, violations: policyViolations(url) }))
      .filter(({ violations }) => violations.length > 0)
    expect(broken).toEqual([])
  })
})
