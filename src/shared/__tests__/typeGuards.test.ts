import { describe, it, expect } from 'vitest'
import { isObjectLike, isOneOf, isPlainObject } from '../typeGuards'

describe('isObjectLike', () => {
  it.each<[string, unknown]>([
    ['空のオブジェクト', {}],
    ['プロパティのあるオブジェクト', { a: 1 }],
    ['配列', []],
    ['プロトタイプの無いオブジェクト', Object.create(null)],
    ['Date', new Date(0)]
  ])('%s は true', (_label, value) => {
    expect(isObjectLike(value)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['null', null],
    ['undefined', undefined],
    ['文字列', 'a'],
    ['数', 0],
    ['真偽値', false],
    ['関数', (): void => {}]
  ])('%s は false', (_label, value) => {
    expect(isObjectLike(value)).toBe(false)
  })
})

describe('isPlainObject', () => {
  it.each<[string, unknown]>([
    ['空のオブジェクト', {}],
    ['プロトタイプの無いオブジェクト', Object.create(null)]
  ])('%s は true', (_label, value) => {
    expect(isPlainObject(value)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['配列', []],
    ['null', null],
    ['undefined', undefined],
    ['文字列', '{}'],
    ['数', 1]
  ])('%s は false', (_label, value) => {
    expect(isPlainObject(value)).toBe(false)
  })
})

describe('isOneOf', () => {
  const KINDS = ['claude', 'copilot'] as const

  it.each(KINDS)('候補の %s は true', (value) => {
    expect(isOneOf(KINDS, value)).toBe(true)
  })

  it.each<[string, unknown]>([
    ['候補にない文字列', 'gemini'],
    ['大文字違い', 'Claude'],
    ['空文字', ''],
    ['null', null],
    ['undefined', undefined],
    ['数', 1],
    ['候補を含む配列', ['claude']]
  ])('%s は false', (_label, value) => {
    expect(isOneOf(KINDS, value)).toBe(false)
  })

  it('空の候補の一覧ではどの値も false', () => {
    expect(isOneOf([], 'claude')).toBe(false)
  })

  it('比べ方は Array.prototype.includes と同じ(型の違う値は一致しない・NaN は一致する)', () => {
    expect(isOneOf([1, 2], 2)).toBe(true)
    expect(isOneOf([1, 2], '2')).toBe(false)
    expect(isOneOf([Number.NaN], Number.NaN)).toBe(true)
  })

  it('一致したとき、値を候補の要素の型に絞り込む', () => {
    const value: unknown = 'copilot'
    if (!isOneOf(KINDS, value)) throw new Error('一致するはず')
    const narrowed: 'claude' | 'copilot' = value
    expect(narrowed).toBe('copilot')
  })
})
