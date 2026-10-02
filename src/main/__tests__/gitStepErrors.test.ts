import { describe, it, expect, vi } from 'vitest'
import { GitError, GitPluginError } from 'simple-git'
import {
  errorDetail,
  failure,
  isGitTimeoutError,
  redactCredentials,
  runGitStep,
  toStepError
} from '../gitStepErrors'
import { getRemoteUrlRuleViolation } from '@shared/remoteUrl'

// git の呼び出しの失敗の変換(リモートの管理・タグの作成・push/pull/fetch が共有する)。実物の simple-git の
// エラーで確かめる(モックの継承関係のずれで判定の誤りを見逃さないため)
const timeoutError = (): GitPluginError =>
  new GitPluginError(undefined, 'timeout', 'block timeout reached')

describe('isGitTimeoutError', () => {
  it('timeout プラグインの GitPluginError は真', () => {
    expect(isGitTimeoutError(timeoutError())).toBe(true)
  })

  it.each([
    ['timeout 以外のプラグインの GitPluginError', new GitPluginError(undefined, 'unsafe', 'x')],
    ['GitError', new GitError(undefined, 'fatal: x')],
    ['通常の Error', new Error('block timeout reached')],
    ['plugin が timeout の通常のオブジェクト', { plugin: 'timeout' }],
    ['Error 以外', 'string']
  ])('%s は偽', (_label, err) => {
    expect(isGitTimeoutError(err)).toBe(false)
  })
})

describe('errorDetail', () => {
  it('Error はメッセージの前後の空白を除いて返す', () => {
    expect(errorDetail(new GitError(undefined, '\n fatal: x \n'))).toBe('fatal: x')
  })

  it.each([
    ['文字列', '  boom  ', 'boom'],
    ['数値', 42, '42'],
    ['undefined', undefined, 'undefined']
  ])('Error 以外(%s)は文字列にして前後の空白を除く', (_label, err, expected) => {
    expect(errorDetail(err)).toBe(expected)
  })
})

describe('failure', () => {
  it('detail があれば「接頭辞: 詳細」', () => {
    expect(failure('リモートを追加できませんでした', 'fatal: x').message).toBe(
      'リモートを追加できませんでした: fatal: x'
    )
  })

  it('detail が空なら接頭辞だけ', () => {
    const err = failure('リモートを追加できませんでした', '')
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toBe('リモートを追加できませんでした')
  })
})

describe('toStepError', () => {
  it('打ち切りは時間切れの文言', () => {
    expect(toStepError(timeoutError(), '時間切れ', '失敗').message).toBe('時間切れ')
  })

  it('それ以外は git のメッセージを添えた失敗の文言', () => {
    expect(toStepError(new GitError(undefined, ' fatal: x\n'), '時間切れ', '失敗').message).toBe(
      '失敗: fatal: x'
    )
  })

  it('メッセージが空なら接頭辞だけ', () => {
    expect(toStepError(new GitError(undefined, '  '), '時間切れ', '失敗').message).toBe('失敗')
  })

  // remote add は config.lock が残っていると `fatal: could not set 'remote.origin.url' to '<url>'` で失敗し、
  // URL を資格情報ごと出す(実機 git 2.50.1 で確認)。呼び出し側が redact を渡すと、詳細を伏せてから添える
  it('redact を渡すと、詳細を伏せてから添える', () => {
    const err = new GitError(
      undefined,
      "fatal: could not set 'remote.origin.url' to 'https://alice:ghp_TOKEN123@github.com/a/b.git'"
    )
    expect(toStepError(err, '時間切れ', '失敗', redactCredentials).message).toBe(
      "失敗: fatal: could not set 'remote.origin.url' to 'https://***@github.com/a/b.git'"
    )
  })

  it('redact を渡さなければ、詳細をそのまま添える(タグ・push などの既存の呼び出し元)', () => {
    expect(toStepError(new GitError(undefined, 'fatal: a@b:c'), '時間切れ', '失敗').message).toBe(
      '失敗: fatal: a@b:c'
    )
  })
})

describe('redactCredentials', () => {
  it.each([
    [
      'https の user:pass',
      'https://alice:ghp_TOKEN123@github.com/a/b.git',
      'https://***@github.com/a/b.git'
    ],
    ['http の user:pass', 'http://u:p@example.com/a.git', 'http://***@example.com/a.git'],
    ['ssh の user:pass と port', 'ssh://alice:pw@host:22/a.git', 'ssh://***@host:22/a.git'],
    [
      'git の user:pass',
      'git://alice:s3cret@127.0.0.1:19418/b.git',
      'git://***@127.0.0.1:19418/b.git'
    ],
    ['file の userinfo', 'file://u:p@/abs/a.git', 'file://***@/abs/a.git'],
    ['パスワードの無い user@', 'https://alice@github.com/a.git', 'https://***@github.com/a.git'],
    ['トークンだけ', 'https://ghp_TOKEN123@github.com/a.git', 'https://***@github.com/a.git'],
    ['パスの無い URL', 'https://u:p@host', 'https://***@host'],
    ['userinfo に @ を含む', 'https://a@b:p@host/x', 'https://***@host/x'],
    ['大文字のスキーム(git が整形した形)', 'HTTPS://u:p@host/x', 'HTTPS://***@host/x'],
    ['scp 形式の user', 'git@github.com:a/b.git', '***@github.com:a/b.git'],
    [
      'ホスト名として出た user:pass',
      'unable to look up alice:s3cret@127.0.0.1:19418 (port 9418)',
      'unable to look up ***@127.0.0.1:19418 (port 9418)'
    ]
  ])('%s を伏せる', (_label, text, expected) => {
    expect(redactCredentials(text)).toBe(expected)
  })

  it('引用符で囲まれた URL を伏せ、引用符は残す', () => {
    expect(redactCredentials('to \'https://a:b@h/x\' and "u@h:p"')).toBe(
      'to \'https://***@h/x\' and "***@h:p"'
    )
  })

  it('複数の URL をすべて伏せる', () => {
    expect(redactCredentials('https://a:1@h1/x ssh://b:2@h2/y c@h3:z')).toBe(
      'https://***@h1/x ssh://***@h2/y ***@h3:z'
    )
  })

  it.each([
    ['URL の無い文', 'fatal: could not lock config file .git/config: File exists'],
    ['userinfo の無い URL', "fatal: unable to access 'https://github.com/a/b.git/': x"],
    ['パスの中の @', 'https://host/a@b/c'],
    ['空文字', '']
  ])('%s は変えない', (_label, text) => {
    expect(redactCredentials(text)).toBe(text)
  })

  it('scp 形式は user だけを伏せ、host と path は残す', () => {
    expect(redactCredentials('fatal: git@example.com:team/repo.git not found')).toBe(
      'fatal: ***@example.com:team/repo.git not found'
    )
  })

  // ssh は `ssh://u:p@ss@127.0.0.1/r` への push で `u:p@ss@127.0.0.1: Permission denied (publickey).` と出す
  // (3 周目のレビューで実機の sshd で確認)。scp 形式の側も、語の中の最後の `@` までを伏せる。URL の検証は
  // authority の `@` を 1 個までに制限する(@shared/remoteUrl)が、`%40` は git が `@` に戻して ssh に渡し、
  // 利用者が端末で追加した origin は検証を通らない
  it.each([
    [
      'ssh の Permission denied',
      'u:p@ss@127.0.0.1: Permission denied (publickey).',
      '***@127.0.0.1: Permission denied (publickey).'
    ],
    [
      'ssh の Could not resolve hostname',
      'ssh: Could not resolve hostname u:p@ss@h: nodename nor servname provided',
      'ssh: Could not resolve hostname ***@h: nodename nor servname provided'
    ],
    ['引用符で囲まれた語', "to 'u:p@ss@h:r'", "to '***@h:r'"],
    [
      'remote add の失敗の文言',
      "could not set 'remote.origin.url' to 'ssh://u:p@ss@h/r'",
      "could not set 'remote.origin.url' to 'ssh://***@h/r'"
    ],
    [
      'https の unable to access',
      "fatal: unable to access 'https://u:p@ss@h/r/'",
      "fatal: unable to access 'https://***@h/r/'"
    ]
  ])('パスワードに @ を含む userinfo(%s)を最後の @ まで伏せる', (_label, text, expected) => {
    expect(redactCredentials(text)).toBe(expected)
  })
})

// 性質テスト(パターン 59): userinfo 付きの URL を組み合わせで作り、URL の検証(@shared/remoteUrl)を通ったものを git・ssh の
// 典型的な失敗の文言に埋め込んで、資格情報(user・パスワード)が出力に残らないことを確かめる。検証はパスワード入りの URL を
// 構造的に拒否する(利用者の決定。認証は credential helper に任せる)ため、通るのは ssh:// のパスワード無しのユーザー名
// だけになる。redactCredentials はその user 名も伏せる(防御の 2 層)。パスワード入りの形を伏せる単体のテストは、
// 検証と独立して上の describe に残す(端末で追加した origin への push の文言など、検証を通らない URL も届くため)。
// ssh の文言には、git が `%XX` を戻した形(sshAuthority)を埋め込む
describe('redactCredentials と URL の検証の組み合わせ', () => {
  const users = ['UsrQx7', 'ghp_TokQx7']
  const passwords = [null, 'PwdZk9', 'Pw%40dZk9', 'Pw@dZk9', 'Pw:dZk9']
  const hosts = ['h.example', '127.0.0.1']
  const schemes = ['https', 'http', 'ssh']
  const candidates = schemes.flatMap((scheme) =>
    users.flatMap((user) =>
      passwords.flatMap((password) =>
        hosts.map((host) => {
          const userinfo = password === null ? user : `${user}:${password}`
          return {
            url: `${scheme}://${userinfo}@${host}/team/r.git`,
            authority: `${userinfo}@${host}`,
            sshAuthority: `${decodeURIComponent(userinfo)}@${host}`,
            host,
            secrets: [user, ...(password === null ? [] : password.split(/%40|@|:/))]
          }
        })
      )
    )
  )
  const allowed = candidates.filter(
    ({ url }) => getRemoteUrlRuleViolation(url, { windowsPaths: false }) === null
  )
  const templates: [string, (c: (typeof candidates)[number]) => string][] = [
    ['Permission denied', (c) => `${c.sshAuthority}: Permission denied (publickey).`],
    ['could not set', (c) => `fatal: could not set 'remote.origin.url' to '${c.url}'`],
    [
      'unable to access',
      (c) => `fatal: unable to access '${c.url}/': The requested URL returned error: 403`
    ],
    [
      'Could not resolve hostname',
      (c) => `ssh: Could not resolve hostname ${c.sshAuthority}: nodename nor servname provided`
    ],
    [
      'Connection refused',
      (c) =>
        `fatal: unable to access '${c.url}': Failed to connect to ${c.host} port 443: Connection refused`
    ]
  ]

  it('検証はパスワード入りの URL をすべて拒否し、ssh:// のユーザー名だけを通す(組み合わせが空にならない)', () => {
    expect(allowed.length).toBeGreaterThan(0)
    expect(allowed.every(({ url }) => url.startsWith('ssh://'))).toBe(true)
    expect(allowed.every(({ secrets }) => secrets.length === 1)).toBe(true)
  })

  it.each(templates)('%s の文言に埋め込んだ資格情報が残らない', (_label, render) => {
    for (const candidate of allowed) {
      const text = render(candidate)
      const out = redactCredentials(text)
      for (const secret of candidate.secrets) expect(out, text).not.toContain(secret)
      expect(out, text).toContain(candidate.host)
    }
  })
})

describe('runGitStep', () => {
  it('成功したら結果をそのまま返し、toError を呼ばない', async () => {
    const toError = vi.fn(() => new Error('x'))
    await expect(runGitStep(async () => 'ok', toError)).resolves.toBe('ok')
    expect(toError).not.toHaveBeenCalled()
  })

  it('失敗したら元のエラーを toError で変換して投げる', async () => {
    const original = new GitError(undefined, 'fatal: x')
    const converted = new Error('変換後')
    const toError = vi.fn(() => converted)
    await expect(
      runGitStep(async () => {
        throw original
      }, toError)
    ).rejects.toBe(converted)
    expect(toError).toHaveBeenCalledWith(original)
  })
})
