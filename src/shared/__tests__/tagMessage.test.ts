import { describe, it, expect } from 'vitest'
import { getTagMessageRuleViolation } from '../tagMessage'

describe('getTagMessageRuleViolation', () => {
  it('軽量タグはメッセージを使わないため、空でも NUL を含んでも null', () => {
    expect(getTagMessageRuleViolation('lightweight', '')).toBeNull()
    expect(getTagMessageRuleViolation('lightweight', 'a\0b')).toBeNull()
  })

  it.each([
    ['空文字', ''],
    ['半角空白だけ', '   '],
    ['全角空白だけ', '　　'],
    ['改行・タブだけ', '\n\t\r\n']
  ])('注釈付きで %s は empty', (_label, message) => {
    expect(getTagMessageRuleViolation('annotated', message)).toBe('empty')
  })

  it('注釈付きで NUL を含むと nul', () => {
    expect(getTagMessageRuleViolation('annotated', 'release\0note')).toBe('nul')
  })

  it('注釈付きで通常のメッセージは null', () => {
    expect(getTagMessageRuleViolation('annotated', ' リリース 1.0 \n')).toBeNull()
  })

  it('空白と NUL だけのメッセージは nul(trim は NUL を除かないため empty にはならない)', () => {
    // 判定は empty → nul の順。String.prototype.trim は NUL を空白とみなさないため、空白と NUL だけでも
    // empty にはならず nul になる
    expect(getTagMessageRuleViolation('annotated', '  \0  ')).toBe('nul')
  })
})
