import { describe, it, expect } from 'vitest'
import { normalizeInitialBranchName } from '@shared/branchName'
import { validateBranchName } from '../branchNameValidation'
import { validateInitialBranchName } from '../initRepositoryValidation'

// ダイアログの検証(UX 用)。規則と順序は main と共有の @shared/branchName を使い、
// git の規則(check-ref-format)の最終判断は main が行う。URL の検証は remoteUrlValidation.test.ts
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
