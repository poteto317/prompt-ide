import { describe, it, expect } from 'vitest'
import { isFsError, isEnoentError } from '../fsErrors'

function makeErrnoError(code: string, message = code): NodeJS.ErrnoException {
  return Object.assign(new Error(message), { code })
}

describe('isFsError', () => {
  it('指定した code と一致するとき true を返す', () => {
    expect(isFsError(makeErrnoError('EEXIST'), 'EEXIST')).toBe(true)
  })

  it('code が一致しないとき false を返す', () => {
    expect(isFsError(makeErrnoError('ENOENT'), 'EEXIST')).toBe(false)
  })

  it('code を省略したとき任意の fs エラーで true を返す', () => {
    expect(isFsError(makeErrnoError('EACCES'))).toBe(true)
    expect(isFsError(makeErrnoError('EPERM'))).toBe(true)
  })

  it('code を省略しても code プロパティが無い Error は false を返す', () => {
    expect(isFsError(new Error('plain'))).toBe(false)
  })

  it('Error インスタンスでないとき false を返す', () => {
    expect(isFsError('not an error', 'EEXIST')).toBe(false)
  })

  it('code プロパティが無い Error のとき false を返す', () => {
    expect(isFsError(new Error('plain'), 'EEXIST')).toBe(false)
  })

  it('code が文字列でないオブジェクト({ code: 123 })は false を返す', () => {
    expect(isFsError(Object.assign(new Error('x'), { code: 123 }))).toBe(false)
  })
})

describe('isEnoentError', () => {
  it('ENOENT のとき true を返す', () => {
    expect(isEnoentError(makeErrnoError('ENOENT'))).toBe(true)
  })

  it('ENOENT 以外のとき false を返す', () => {
    expect(isEnoentError(makeErrnoError('EACCES'))).toBe(false)
  })

  it('code の無いプレーン Error のとき false を返す({ code: "ENOENT" } もどきの誤判定防止)', () => {
    expect(isEnoentError(new Error('ENOENT'))).toBe(false)
  })
})
