import { describe, it, expect } from 'vitest'
import { normalizeInitialBranchName } from '@shared/branchName'
import { validateBranchName } from '../branchNameValidation'
import { validateInitialBranchName, validateRemoteUrl } from '../remoteSetupValidation'

// ダイアログの検証(UX 用)。規則と順序は main と共有の @shared/branchName・@shared/remoteUrl を使い、
// git の規則(check-ref-format)と Windows のドライブの形の最終判断は main が行う
describe('validateInitialBranchName', () => {
  it.each([
    ['', '名前を入力してください'],
    ['   ', '名前を入力してください'],
    ['-x', '`-` で始まる名前は使用できません'],
    ['@', 'この名前は使用できません']
  ])('%j → %s', (name, message) => {
    expect(validateInitialBranchName(name)).toBe(message)
  })

  // HEAD・a..b などは main の check-ref-format に委ねる(ダイアログでは通す)
  it.each(['main', '  main  ', 'feat/x', 'HEAD', 'a..b', '日本語'])('%j は null', (name) => {
    expect(validateInitialBranchName(name)).toBeNull()
  })

  // 文言の表はブランチの作成ダイアログ(validateBranchName)と共有する(同じ層に表を 2 つ持たない。パターン 88)。
  // 値は main の入口と同じ正規化(前後の空白の除去・NFC)を通してから検証する(パターン 83)
  it.each(['', '-x', '@', '  -x  ', '\t@\n', 'e\u0301', '  main  ', 'HEAD'])(
    '%j は validateBranchName(normalizeInitialBranchName(x), []) と一致する',
    (name) => {
      expect(validateInitialBranchName(name)).toBe(
        validateBranchName(normalizeInitialBranchName(name), [])
      )
    }
  )
})

describe('validateRemoteUrl', () => {
  it.each([
    ['', 'URL を入力してください'],
    ['  \n', 'URL を入力してください'],
    [`https://h/${'a'.repeat(2039)}`, 'URL が長すぎます（2048 文字まで）'],
    ['https://h/a b', 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'],
    // 引用符も invalid-char(main と共有の判定)
    ["https://u:p'ss@h/r", 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'],
    ["/repos/O'Brien/b.git", 'URL に空白・改行・制御文字・引用符（\' " `）は使用できません'],
    ['--upload-pack=x', '`-` で始まる URL は使用できません'],
    [
      'ext::sh',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // git:// は userinfo を許可しない(main と共有の判定)
    [
      'git://alice:s3cret@host/a',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // authority の `@` は 1 個まで(main と共有の判定)
    [
      'ssh://u:p@ss@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // ssh:// の userinfo を decode した結果に `/` があれば拒否する(main と共有の判定。4 周目のレビュー)
    [
      'ssh://alice:s3cr%2Fet@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // userinfo の生の `/` で authority が `user:pa` に切れる形は、port が数字でないため拒否する(main と共有の判定。
    // 5 周目のレビュー)
    [
      'ssh://user:pa/ss@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    // パスワード入りの URL は構造的に拒否する(main と共有の判定。認証は credential helper に任せる)
    [
      'https://alice:ghp_TOKEN@github.com/a/b.git',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    [
      'https://alice:1234/s3cret@h/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ],
    [
      'https://h#sec@h2/r',
      '使用できない形式の URL です（https://・http://・ssh://・git://・file://・user@host:path・絶対パスが使えます）。ユーザー名・パスワード入りの http(s) URL は使えません（認証は credential helper か ssh の鍵を使います）'
    ]
  ])('%j → %s', (url, message) => {
    expect(validateRemoteUrl(url)).toBe(message)
  })

  // renderer は platform を知らないため、Windows のドライブの形は寛容側で通す(最終判断は main)
  it.each([
    'https://github.com/a/b.git',
    '  git@github.com:a/b.git  ',
    '/abs/bare.git',
    'C:/repos/a.git'
  ])('%j は null', (url) => {
    expect(validateRemoteUrl(url)).toBeNull()
  })
})
