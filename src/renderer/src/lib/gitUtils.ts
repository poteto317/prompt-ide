export function statusChar(code: string): string {
  if (code === '?') return 'U'
  return code.trim() || '·'
}

const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS

/**
 * ISO 8601 形式の日時文字列(getLog が %aI で取得する entry.date)を、
 * 「3分前」のような簡単な相対日時表記に変換する。
 * 1ヶ月以上前は具体的な日付表記にフォールバックする。
 */
export function formatRelativeDate(isoDate: string, now: Date = new Date()): string {
  const target = new Date(isoDate)
  const diffMs = now.getTime() - target.getTime()
  if (Number.isNaN(diffMs)) return ''
  if (diffMs < MINUTE_MS) return 'たった今'
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}分前`
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}時間前`
  if (diffMs < MONTH_MS) return `${Math.floor(diffMs / DAY_MS)}日前`
  return target.toLocaleDateString()
}
