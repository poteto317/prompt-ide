import { describe, it, expect } from 'vitest'
import { formatEventDate, progressSummary, formatEventMeta } from '../stageDisplay'

describe('formatEventDate', () => {
  it('YYYY/MM/DD HH:mm 形式に整形する', () => {
    const ts = new Date(2026, 4, 31, 10, 5).getTime()
    expect(formatEventDate(ts)).toBe('2026/05/31 10:05')
  })

  it('1 桁の月日時分をゼロ埋めする', () => {
    const ts = new Date(2026, 0, 2, 3, 4).getTime()
    expect(formatEventDate(ts)).toBe('2026/01/02 03:04')
  })
})

describe('progressSummary', () => {
  it('done 数 / 総数 を返す', () => {
    expect(progressSummary(5, 8)).toBe('5/8')
  })

  it('0 / 0 を返す', () => {
    expect(progressSummary(0, 0)).toBe('0/0')
  })

  it('全完了の場合 total/total を返す', () => {
    expect(progressSummary(8, 8)).toBe('8/8')
  })
})

describe('formatEventMeta', () => {
  it('単一エントリを "key: value" 形式で返す', () => {
    expect(formatEventMeta({ commit: 'abc' })).toBe('commit: abc')
  })

  it('複数エントリを " / " で連結する', () => {
    expect(formatEventMeta({ commit: 'abc', pr: '7' })).toBe('commit: abc / pr: 7')
  })

  it('空オブジェクトは空文字を返す', () => {
    expect(formatEventMeta({})).toBe('')
  })
})
