import { describe, it, expect } from 'vitest'
import { isSamePlainData } from '../plainDataEquality'

describe('isSamePlainData', () => {
  it('中身が同じ別のオブジェクト・配列 → true', () => {
    expect(isSamePlainData({ a: 1, b: [1, { c: 'x' }] }, { a: 1, b: [1, { c: 'x' }] })).toBe(true)
    expect(isSamePlainData([], [])).toBe(true)
  })

  it('同じ参照・同じ素の値・null どうし → true', () => {
    const value = { a: 1 }
    expect(isSamePlainData(value, value)).toBe(true)
    expect(isSamePlainData('a', 'a')).toBe(true)
    expect(isSamePlainData(null, null)).toBe(true)
  })

  it('値が undefined のキーは、キーが無いのと同じ', () => {
    expect(isSamePlainData({ a: 1, b: undefined }, { a: 1 })).toBe(true)
    expect(isSamePlainData({ a: 1 }, { a: 1, b: undefined })).toBe(true)
  })

  it.each<[string, unknown, unknown]>([
    ['素の値が違う', 1, 2],
    ['片方だけ null', { a: 1 }, null],
    ['配列とオブジェクト', [], {}],
    ['キーの数が違う', { a: 1 }, { a: 1, b: 2 }],
    ['同じ数で別のキー', { a: 1 }, { b: 1 }],
    ['入れ子の値が違う', { a: { b: [1, 2] } }, { a: { b: [1, 3] } }],
    ['配列の順が違う', [1, 2], [2, 1]],
    ['配列の長さが違う', [1], [1, 1]],
    ['undefined と空の配列', { a: undefined }, { a: [] }]
  ])('%s → false', (_label, a, b) => {
    expect(isSamePlainData(a, b)).toBe(false)
  })
})
