import { describe, it, expect } from 'vitest'
import { statusChar } from '../gitUtils'

describe('statusChar', () => {
  it('"?" → "U"（未追跡ファイル）', () => {
    expect(statusChar('?')).toBe('U')
  })

  it('"M" → "M"（変更）', () => {
    expect(statusChar('M')).toBe('M')
  })

  it('"A" → "A"（追加）', () => {
    expect(statusChar('A')).toBe('A')
  })

  it('"D" → "D"（削除）', () => {
    expect(statusChar('D')).toBe('D')
  })

  it('" "（スペース）→ "·"（変更なし）', () => {
    expect(statusChar(' ')).toBe('·')
  })

  it('""（空文字）→ "·"', () => {
    expect(statusChar('')).toBe('·')
  })
})
