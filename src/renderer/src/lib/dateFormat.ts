const MINUTE_MS = 60 * 1000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS
const MONTH_MS = 30 * DAY_MS

/**
 * ISO 8601 形式の日時文字列を、「3分前」のような簡単な相対日時表記に変換する。
 * 1ヶ月以上前は具体的な日付表記にフォールバックする。
 */
export function formatRelativeDate(isoDate: string, now: Date = new Date()): string {
  const target = new Date(isoDate)
  const diffMs = now.getTime() - target.getTime()
  if (Number.isNaN(diffMs)) return ''
  // diffMs < MINUTE_MS だけで判定すると、負の値(未来の日時)は大きさに関わらず
  // 常に真になり、「1時間後」のような明らかなクロックスキューまで「たった今」に
  // 丸めてしまう。1分未満の軽微なずれ(クロックスキューの許容範囲)だけを
  // 「たった今」として吸収し、それを超える未来は具体的な日付表記にフォールバックする
  if (Math.abs(diffMs) < MINUTE_MS) return 'たった今'
  // toLocaleDateString() をロケール引数無しで呼ぶと、OS/ブラウザのデフォルト
  // ロケールに従って表示される。他の分岐(「3分前」等)は日本語固定文字列のため、
  // 英語ロケール環境では「9/27/2026」のような表記だけが混ざり、履歴一覧の
  // 表示形式が食い違う。'ja-JP' を明示して固定する
  if (diffMs < 0) return target.toLocaleDateString('ja-JP')
  if (diffMs < HOUR_MS) return `${Math.floor(diffMs / MINUTE_MS)}分前`
  if (diffMs < DAY_MS) return `${Math.floor(diffMs / HOUR_MS)}時間前`
  if (diffMs < MONTH_MS) return `${Math.floor(diffMs / DAY_MS)}日前`
  return target.toLocaleDateString('ja-JP')
}
