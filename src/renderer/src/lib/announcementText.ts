import type { Announcement } from '../types'

/**
 * role="status" に入れる通知の文字列。ライブリージョンは内容が同じだと読み上げ直さないため、id が偶数の
 * 通知は末尾にゼロ幅スペースを付けて文字列を変える(id を 1 つずつ進めれば、同じ文言が続いても毎回変わる。
 * パターン 87)。通知が無い・文言が空なら空文字列
 */
export function toAnnouncementText(announcement: Announcement | null): string {
  if (announcement === null || announcement.text === '') return ''
  return announcement.text + (announcement.id % 2 === 1 ? '' : '\u200b')
}
