import { describe, it, expect } from 'vitest'
import { validateCloneFolderName } from '../cloneValidation'

// 判定は @shared/cloneFolderName(main と共有)。ここは文言の表だけを確かめる
describe('validateCloneFolderName', () => {
  it.each([
    ['', 'フォルダ名を入力してください'],
    ['   ', 'フォルダ名を入力してください'],
    ['a/b', 'フォルダ名に使えない文字が含まれています'],
    ['..', 'フォルダ名に使えない文字が含まれています'],
    [' b', 'フォルダ名に使えない文字が含まれています']
  ])('%j → %s', (name, message) => {
    expect(validateCloneFolderName(name)).toBe(message)
  })

  it.each(['b', 'my-repo', 'リポ'])('%j は null', (name) => {
    expect(validateCloneFolderName(name)).toBeNull()
  })
})
