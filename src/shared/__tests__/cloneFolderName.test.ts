import { describe, it, expect } from 'vitest'
import { deriveCloneFolderName, getCloneFolderNameViolation } from '../cloneFolderName'
import { getRemoteUrlRuleViolation } from '../remoteUrl'

// 期待値の「git」の列は、実機 git 2.50.1 で `git clone <url>`(保存先を省略)が出した `Cloning into '<名前>'...`
// (ネットワークに出ないよう、ホストは 127.0.0.1 の閉じたポート・偽の ssh で確認)。アプリの規則は git に揃え、
// 食い違うのは query・fragment(git は名前に含める)・ホストだけ・`.` になる形(git はホスト名・`.` を使う)だけ
describe('deriveCloneFolderName', () => {
  it.each([
    // [URL, アプリの既定値, git の名前]
    ['https://github.com/a/b.git', 'b', 'b'],
    ['https://github.com/a/b', 'b', 'b'],
    ['https://github.com/a/b/', 'b', 'b'],
    ['https://github.com/a/b.git/', 'b', 'b'],
    ['https://github.com/a/b.git///', 'b', 'b'],
    ['https://github.com/a/b/.git', 'b', 'b'],
    ['https://github.com/a/b/.git/', 'b', 'b'],
    ['https://github.com/a/b.git.git', 'b.git', 'b.git'],
    ['https://github.com/a/b.c.git', 'b.c', 'b.c'],
    ['https://github.com/a/b.GIT', 'b.GIT', 'b.GIT'],
    ['https://github.com/a/b.bundle', 'b.bundle', 'b.bundle'],
    ['https://host:8443/~user/repo.git', 'repo', 'repo'],
    ['https://github.com/a/%E6%97%A5.git', '%E6%97%A5', '%E6%97%A5'],
    ['https://github.com/a/-x.git', '-x', '-x'],
    ['https://github.com/a/b:c.git', 'c', 'c'],
    ['http://example.com/a.git', 'a', 'a'],
    ['ssh://git@host:22/a/b.git', 'b', 'b'],
    ['ssh://git@host/b.git', 'b', 'b'],
    ['ssh://host/a/b', 'b', 'b'],
    ['git://host:9418/a/b.git', 'b', 'b'],
    ['git@github.com:a/b.git', 'b', 'b'],
    ['git@github.com:b.git', 'b', 'b'],
    ['git@github.com:b', 'b', 'b'],
    ['git@github.com:a/b/', 'b', 'b'],
    ['file:///abs/bare.git', 'bare', 'bare'],
    ['/abs/path/repo.git', 'repo', 'repo'],
    ['/abs/path/repo.git/', 'repo', 'repo'],
    ['/abs/worktree-repo', 'worktree-repo', 'worktree-repo'],
    ['/abs/worktree-repo/.git', 'worktree-repo', 'worktree-repo'],
    ['/abs/日本語/リポ.git', 'リポ', 'リポ'],
    ['  https://github.com/a/b.git \n', 'b', 'b']
  ])('%s は %s(git も %s)', (url, expected) => {
    expect(deriveCloneFolderName(url)).toBe(expected)
  })

  // git と食い違う形。名前として使いにくい・使えないため、アプリは query・fragment を落とすか空にする(利用者が入力する)
  it.each([
    // [URL, アプリの既定値, git の名前]
    ['https://github.com/a/b.git?x=1', 'b', 'b.git?x=1'],
    ['https://github.com/a/b?x=1', 'b', 'b?x=1'],
    ['https://github.com/a/b.git#frag', 'b', 'b.git#frag'],
    ['https://github.com/a/b#frag', 'b', 'b#frag'],
    ['https://github.com', '', 'github.com'],
    ['https://github.com/', '', 'github.com'],
    ['ssh://host', '', 'host'],
    ['git@host:', '', 'host'],
    ['git@host:/', '', 'host'],
    ['https://github.com/a/..git', '', '.'],
    ['', '', '(URL が無い)']
  ])('%s は %s(git は %s)', (url, expected) => {
    expect(deriveCloneFolderName(url)).toBe(expected)
  })

  // scp 形式・絶対パスの `?` `#` はパスの一部(git と同じく名前に残す)
  it('scp 形式の ? は名前に残す', () => {
    expect(deriveCloneFolderName('git@host:a/b.git?x')).toBe('b.git?x')
  })

  // renderer は Windows のドライブの形も寛容に通す(validateRemoteUrl の windowsPaths: true)ため、名前も決める
  it.each([
    ['C:\\repos\\bare.git', 'bare'],
    ['C:\\repos\\bare.git\\', 'bare'],
    ['C:/repos/bare.git', 'bare'],
    ['C:\\repos\\work\\.git', 'work'],
    ['C:\\', '']
  ])('Windows のドライブの形 %s は %s', (url, expected) => {
    expect(deriveCloneFolderName(url)).toBe(expected)
  })

  // 既定値は、そのまま保存先の名前の検証を通るか空(空なら利用者に入力させる)
  it('既定値は空か、名前の検証を通る', () => {
    const urls = [
      'https://github.com/a/b.git',
      'https://github.com/a/..git',
      'https://github.com/a/.git',
      'git@host:a/ b .git',
      'git@host:a/\u3000.git',
      'https://github.com'
    ]
    for (const url of urls) {
      const name = deriveCloneFolderName(url)
      expect(name === '' || getCloneFolderNameViolation(name) === null).toBe(true)
    }
  })

  // URL の許可リスト(@shared/remoteUrl)を通る代表の形は、すべて空でない名前になる(ダイアログの既定値が出る)
  it('許可リストを通る代表の URL は空でない名前になる', () => {
    const allowed = [
      'https://github.com/a/b.git',
      'http://example.com/a.git',
      'ssh://git@host:22/a.git',
      'git://host/a',
      'git@github.com:a/b.git',
      'file:///abs/bare.git',
      '/abs/bare.git'
    ]
    for (const url of allowed) {
      expect(getRemoteUrlRuleViolation(url, { windowsPaths: false })).toBeNull()
      expect(deriveCloneFolderName(url)).not.toBe('')
    }
  })
})

describe('getCloneFolderNameViolation', () => {
  it.each(['b', 'my-repo', 'リポ', 'b.git', '-x', 'a b', '.hidden'])('%s は使える', (name) => {
    expect(getCloneFolderNameViolation(name)).toBeNull()
  })

  it.each(['', ' ', '\u3000', '\n'])('空・空白だけ(%j)は empty', (name) => {
    expect(getCloneFolderNameViolation(name)).toBe('empty')
  })

  it.each(['.', '..', 'a/b', 'a\\b', '/abs', ' b', 'b ', '../x'])('%j は invalid', (name) => {
    expect(getCloneFolderNameViolation(name)).toBe('invalid')
  })
})
