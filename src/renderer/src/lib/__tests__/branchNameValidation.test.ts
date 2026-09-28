import { describe, it, expect } from 'vitest'
import { validateBranchName } from '../branchNameValidation'

describe('validateBranchName', () => {
  it('空文字は「名前を入力してください」', () => {
    expect(validateBranchName('', ['main'])).toBe('名前を入力してください')
  })

  it("'-' で始まる名前は拒否する", () => {
    expect(validateBranchName('-x', ['main'])).toBe('`-` で始まる名前は使用できません')
  })

  // git checkout @ は HEAD の別名として解釈され、作成後に切り替えられない
  // (main 側の createBranch と同じ理由)
  it("'@' のみの名前は拒否する", () => {
    expect(validateBranchName('@', ['main'])).toBe('この名前は使用できません')
  })

  it('既存のブランチ名と一致したら拒否する', () => {
    expect(validateBranchName('main', ['main'])).toBe('同じ名前のブランチが既に存在します')
  })

  // 規則違反(@shared/branchName)は重複チェックより先に判定する
  it('規則違反の名前は既存ブランチと一致していても規則違反の文言を返す', () => {
    expect(validateBranchName('@', ['@'])).toBe('この名前は使用できません')
  })

  // git は `cannot lock ref` の英語エラーで失敗するため、ダイアログ内で先に伝える
  it('既存ブランチと階層が衝突する名前は拒否する', () => {
    expect(validateBranchName('main/sub', ['main'])).toBe('既存のブランチ main と名前が衝突します')
    expect(validateBranchName('feature', ['feature/x'])).toBe(
      '既存のブランチ feature/x と名前が衝突します'
    )
  })

  // それ以外の形式(`..` 等)は main 側の git check-ref-format に委ねる
  it('それ以外は null(通過)を返す', () => {
    expect(validateBranchName('feature/new', ['main'])).toBeNull()
    expect(validateBranchName('a..b', ['main'])).toBeNull()
  })
})
