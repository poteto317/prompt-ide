import { describe, it, expect } from 'vitest'
import { toAnnouncementText } from '../announcementText'

const ZWSP = '\u200b'

describe('toAnnouncementText', () => {
  it('通知が無ければ空文字列', () => {
    expect(toAnnouncementText(null)).toBe('')
  })

  it('文言が空なら、id に関係なく空文字列(ゼロ幅スペースだけを出さない)', () => {
    expect(toAnnouncementText({ text: '', id: 0 })).toBe('')
    expect(toAnnouncementText({ text: '', id: 2 })).toBe('')
  })

  it('id が奇数なら文言のまま', () => {
    expect(toAnnouncementText({ text: '挿入しました', id: 1 })).toBe('挿入しました')
    expect(toAnnouncementText({ text: '挿入しました', id: 3 })).toBe('挿入しました')
  })

  it('id が偶数なら末尾にゼロ幅スペースを付ける', () => {
    expect(toAnnouncementText({ text: '挿入しました', id: 2 })).toBe(`挿入しました${ZWSP}`)
  })

  it('同じ文言が続いても(id が 1 つ進めば)文字列が変わる', () => {
    for (const id of [1, 2, 3, 4]) {
      expect(toAnnouncementText({ text: 'X', id })).not.toBe(
        toAnnouncementText({ text: 'X', id: id + 1 })
      )
    }
  })
})
