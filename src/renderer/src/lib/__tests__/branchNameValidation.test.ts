import { describe, it, expect } from 'vitest'
import { validateBranchName } from '../branchNameValidation'

describe('validateBranchName', () => {
  it('空文字は「名前を入力してください」', () => {
    expect(validateBranchName('', ['main'])).toBe('名前を入力してください')
  })

  it("'-' で始まる名前は拒否する", () => {
    expect(validateBranchName('-x', ['main'])).toBe('`-` で始まる名前は使用できません')
  })

  it('既存のブランチ名と一致したら拒否する', () => {
    expect(validateBranchName('main', ['main'])).toBe('同じ名前のブランチが既に存在します')
  })

  // それ以外の形式(`..` 等)は main 側の git check-ref-format に委ねる
  it('それ以外は null(通過)を返す', () => {
    expect(validateBranchName('feature/new', ['main'])).toBeNull()
    expect(validateBranchName('a..b', ['main'])).toBeNull()
  })
})
