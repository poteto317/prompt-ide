import { describe, it, expect } from 'vitest'
import { formatRelativeDate } from '../dateFormat'

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
    expect(formatRelativeDate(date.toISOString(), now)).toBe(date.toLocaleDateString('ja-JP'))
  })

  it('1ヶ月以上前の日付表記は、OS/ブラウザのデフォルトロケールに関わらず日本語ロケールで表示する', () => {
    // toLocaleDateString() をロケール引数無しで呼ぶと、他の分岐(「3分前」等)が
    // 日本語固定文字列なのに、この行だけ OS/ブラウザのデフォルトロケールに従って
    // 表示される。英語ロケール環境では「9/27/2026」のような表記になり、
    // 履歴一覧の他の行と表示形式が食い違う
    const date = new Date(now.getTime() - 60 * 24 * 60 * 60 * 1000)
    expect(formatRelativeDate(date.toISOString(), now)).toBe(date.toLocaleDateString('ja-JP'))
    expect(formatRelativeDate(date.toISOString(), now)).not.toBe(date.toLocaleDateString('en-US'))
  })

  it('不正な日時文字列の場合は空文字を返す', () => {
    expect(formatRelativeDate('not-a-date', now)).toBe('')
  })

  it('未来の日時の場合も「たった今」を返す（クロックスキュー等の防御）', () => {
    const futureDate = new Date(now.getTime() + 5 * 1000).toISOString()
    expect(formatRelativeDate(futureDate, now)).toBe('たった今')
  })

  it('1分以上未来にずれている場合は「たった今」ではなく具体的な日付表記にフォールバックする', () => {
    // diffMs < MINUTE_MS は負の値(未来)なら大きさに関わらず常に真になるため、
    // これだけで判定すると「1時間後」のような明らかなクロックスキューまで
    // 「たった今」に丸めてしまい、実際の時計のずれに気づけなくなる
    const futureDate = new Date(now.getTime() + 60 * 60 * 1000)
    expect(formatRelativeDate(futureDate.toISOString(), now)).toBe(
      futureDate.toLocaleDateString('ja-JP')
    )
  })
})
