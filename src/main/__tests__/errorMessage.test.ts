import { describe, it, expect } from 'vitest'
import { errorMessageOf } from '../errorMessage'

describe('errorMessageOf', () => {
  it('Error なら message を返す', () => {
    expect(errorMessageOf(new Error('boom'))).toBe('boom')
  })

  it('Error の派生(TypeError・code 付きの fs のエラー)も message を返す', () => {
    expect(errorMessageOf(new TypeError('bad type'))).toBe('bad type')
    const fsError = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    expect(errorMessageOf(fsError)).toBe('ENOENT: no such file')
  })

  it('message が空の Error は空文字列を返す(String(error) の "Error" にしない)', () => {
    expect(errorMessageOf(new Error(''))).toBe('')
  })

  it.each<[string, unknown, string]>([
    ['文字列', 'plain', 'plain'],
    ['数値', 42, '42'],
    ['null', null, 'null'],
    ['undefined', undefined, 'undefined'],
    ['message を持つ Error でないオブジェクト', { message: 'fake' }, '[object Object]']
  ])('Error 以外(%s)は String() で文字列にする', (_label, value, expected) => {
    expect(errorMessageOf(value)).toBe(expected)
  })
})
