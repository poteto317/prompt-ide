import { describe, it, expect } from 'vitest'
import { toError } from '../errorUtils'

describe('toError', () => {
  it('Error インスタンスはそのまま返す', () => {
    const err = new Error('boom')
    expect(toError(err)).toBe(err)
  })

  it('Error 以外の値は文字列化して Error にラップする', () => {
    const result = toError('boom')
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('boom')
  })

  it('undefined も Error にラップする', () => {
    const result = toError(undefined)
    expect(result).toBeInstanceOf(Error)
    expect(result.message).toBe('undefined')
  })
})
