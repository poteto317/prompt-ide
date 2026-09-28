import { describe, it, expect } from 'vitest'
import { findConflictingBranchName, getBranchNameRuleViolation } from '../branchName'

describe('getBranchNameRuleViolation', () => {
  it('空文字は empty', () => {
    expect(getBranchNameRuleViolation('')).toBe('empty')
  })

  // '-' 始まりは git にオプションとして解釈される(引数インジェクション)
  it.each(['-x', '--orphan', '-'])("'-' で始まる名前 %s は leading-dash", (name) => {
    expect(getBranchNameRuleViolation(name)).toBe('leading-dash')
  })

  // git checkout @ は HEAD の別名として解釈され、作成後に切り替えられない
  it("'@' のみの名前は head-alias", () => {
    expect(getBranchNameRuleViolation('@')).toBe('head-alias')
  })

  // '@' を含むだけの名前や '-' を途中に含む名前は、この規則の対象外
  // (git 本体の規則は main 側の check-ref-format に委ねる)
  it.each(['feature/new', 'a-b', 'foo@bar', '@x', 'a..b'])('%s は null', (name) => {
    expect(getBranchNameRuleViolation(name)).toBeNull()
  })
})

// refs/heads 配下はディレクトリ構造のため、'main' と 'main/sub' のように一方が他方の
// 親階層になる名前は共存できない(git は `cannot lock ref` の英語エラーで失敗する)
describe('findConflictingBranchName', () => {
  it('既存ブランチの配下になる名前は、その既存ブランチ名を返す', () => {
    expect(findConflictingBranchName('main/sub', ['main', 'dev'])).toBe('main')
  })

  it('既存ブランチの親階層になる名前は、その既存ブランチ名を返す', () => {
    expect(findConflictingBranchName('feature', ['main', 'feature/x'])).toBe('feature/x')
  })

  it('深い階層でも親子関係なら衝突とみなす', () => {
    expect(findConflictingBranchName('a/b/c/d', ['a/b'])).toBe('a/b')
    expect(findConflictingBranchName('a', ['a/b/c'])).toBe('a/b/c')
  })

  // 前方一致しても階層の区切り('/')でなければ別の名前として共存できる
  it.each([
    ['feature-x', ['feature']],
    ['feat', ['feature/x']],
    ['feature/xy', ['feature/x']],
    ['main', ['main']]
  ])('%s は %j と衝突しない(完全一致の重複は別の検証で扱う)', (name, existing) => {
    expect(findConflictingBranchName(name, existing)).toBeNull()
  })

  it('既存ブランチが無ければ null', () => {
    expect(findConflictingBranchName('main/sub', [])).toBeNull()
  })
})
