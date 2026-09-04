import { describe, it, expect } from 'vitest'
import { statusChar, formatRelativeDate } from '../gitUtils'

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

describe('formatRelativeDate', () => {
  const now = new Date('2026-09-03T12:00:00+09:00')

  it('1分未満前は「たった今」', () => {
    const date = new Date(now.getTime() - 30 * 1000).toISOString()
    expect(formatRelativeDate(date, now)).toBe('たった今')
  })

  it('分単位で「○分前」', () => {
    const date = new Date(now.getTime() - 5 * 60 * 1000).toISOString()
    expect(formatRelativeDate(date, now)).toBe('5分前')
  })

  it('時間単位で「○時間前」', () => {
    const date = new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeDate(date, now)).toBe('3時間前')
  })

  it('日単位で「○日前」', () => {
    const date = new Date(now.getTime() - 5 * 24 * 60 * 60 * 1000).toISOString()
    expect(formatRelativeDate(date, now)).toBe('5日前')
  })

  it('1ヶ月以上前は具体的な日付表記にフォールバックする', () => {
    const date = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    expect(formatRelativeDate(date.toISOString(), now)).toBe(date.toLocaleDateString())
  })

  it('不正な日時文字列の場合は空文字を返す', () => {
    expect(formatRelativeDate('not-a-date', now)).toBe('')
  })
})
