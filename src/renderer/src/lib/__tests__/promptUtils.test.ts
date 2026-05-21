import { describe, it, expect } from 'vitest'
import { truncatePreview } from '../promptUtils'

describe('truncatePreview', () => {
  it('50文字未満のコンテンツはそのまま返す', () => {
    const content = 'a'.repeat(49)
    expect(truncatePreview(content)).toBe(content)
  })

  it('50文字ちょうどはそのまま返す', () => {
    const content = 'x'.repeat(50)
    expect(truncatePreview(content)).toBe(content)
  })

  it('51文字以上は50文字 + … に切り詰める', () => {
    const content = 'a'.repeat(51)
    expect(truncatePreview(content)).toBe('a'.repeat(50) + '…')
  })

  it('100文字のコンテンツは50文字 + … に切り詰める', () => {
    const content = 'b'.repeat(100)
    expect(truncatePreview(content)).toBe('b'.repeat(50) + '…')
  })

  it('空文字列は空文字列を返す', () => {
    expect(truncatePreview('')).toBe('')
  })
})
