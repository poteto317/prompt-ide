import { describe, it, expect } from 'vitest'
import {
  findConflictingBranchName,
  getBranchNameRuleViolation,
  normalizeInitialBranchName
} from '../branchName'

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

// リポジトリの初期化の最初のブランチ名。main(initRepository の入口)と renderer(初期化ダイアログ)が
// 同じ正規化を使う(パターン 83)。macOS の git は NFD の名前をそのまま refs/heads/<NFD> にする(実機で確認)
describe('normalizeInitialBranchName', () => {
  it('前後の空白・改行を除く', () => {
    expect(normalizeInitialBranchName('  main \n')).toBe('main')
  })

  it('NFD を NFC にそろえる', () => {
    expect(normalizeInitialBranchName('cafe\u0301')).toBe('caf\u00e9')
  })

  // 途中の空白は git の規則(check-ref-format)で main が拒否する。ここでは変えない
  it('途中の空白は残す', () => {
    expect(normalizeInitialBranchName('a b')).toBe('a b')
  })
})
