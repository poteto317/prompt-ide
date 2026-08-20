import { describe, it, expect } from 'vitest'
import { toHighlightSegments } from '../highlightSegments'

describe('toHighlightSegments', () => {
  it('マッチが無いとき全体を非マッチの 1 区間として返す', () => {
    expect(toHighlightSegments('index.ts', [])).toEqual([{ text: 'index.ts', matched: false }])
  })

  it('空文字列に対して空配列を返す', () => {
    expect(toHighlightSegments('', [])).toEqual([])
  })

  it('連続したマッチを 1 区間にまとめる', () => {
    expect(toHighlightSegments('index.ts', [0, 1, 2])).toEqual([
      { text: 'ind', matched: true },
      { text: 'ex.ts', matched: false }
    ])
  })

  it('離れたマッチを別々の区間に分ける', () => {
    expect(toHighlightSegments('useFileSystem.ts', [0, 1, 3, 7])).toEqual([
      { text: 'us', matched: true },
      { text: 'e', matched: false },
      { text: 'F', matched: true },
      { text: 'ile', matched: false },
      { text: 'S', matched: true },
      { text: 'ystem.ts', matched: false }
    ])
  })

  it('末尾までマッチしている場合も区間を取りこぼさない', () => {
    expect(toHighlightSegments('abc', [2])).toEqual([
      { text: 'ab', matched: false },
      { text: 'c', matched: true }
    ])
  })

  it('全文字がマッチのとき 1 区間になる', () => {
    expect(toHighlightSegments('abc', [0, 1, 2])).toEqual([{ text: 'abc', matched: true }])
  })
})
