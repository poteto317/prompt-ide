import { describe, it, expect } from 'vitest'
import { isValidPrompt, sanitizePrompt } from '../promptUtils'
import type { Prompt } from '@shared/types'

const validPrompt: Prompt = {
  id: 'p1',
  title: 'タイトル',
  content: 'コンテンツ',
  createdAt: 1000000,
}

describe('isValidPrompt', () => {
  it('正しい形式の Prompt を有効と判定する', () => {
    expect(isValidPrompt(validPrompt)).toBe(true)
  })

  it('余分なプロパティがあっても有効と判定する', () => {
    expect(isValidPrompt({ ...validPrompt, extra: 'foo' })).toBe(true)
  })

  it('null は無効', () => {
    expect(isValidPrompt(null)).toBe(false)
  })

  it('プリミティブは無効', () => {
    expect(isValidPrompt('string')).toBe(false)
    expect(isValidPrompt(42)).toBe(false)
  })

  it('id が string でない場合は無効', () => {
    expect(isValidPrompt({ ...validPrompt, id: 123 })).toBe(false)
  })

  it('title が string でない場合は無効', () => {
    expect(isValidPrompt({ ...validPrompt, title: null })).toBe(false)
  })

  it('content が string でない場合は無効', () => {
    expect(isValidPrompt({ ...validPrompt, content: [] })).toBe(false)
  })

  it('createdAt が number でない場合は無効', () => {
    expect(isValidPrompt({ ...validPrompt, createdAt: '2024' })).toBe(false)
  })

  it('createdAt が NaN の場合は無効', () => {
    expect(isValidPrompt({ ...validPrompt, createdAt: NaN })).toBe(false)
  })

  it('createdAt が Infinity の場合は無効', () => {
    expect(isValidPrompt({ ...validPrompt, createdAt: Infinity })).toBe(false)
  })

  it('createdAt が -Infinity の場合は無効', () => {
    expect(isValidPrompt({ ...validPrompt, createdAt: -Infinity })).toBe(false)
  })

  it('フィールドが欠落している場合は無効', () => {
    const { title: _t, ...withoutTitle } = validPrompt
    expect(isValidPrompt(withoutTitle)).toBe(false)
  })
})

describe('sanitizePrompt', () => {
  it('必要な 4 フィールドのみを返す', () => {
    expect(sanitizePrompt(validPrompt)).toEqual(validPrompt)
  })

  it('余分なプロパティを除去する', () => {
    const withExtra = { ...validPrompt, extra: 'should be removed' } as Prompt & {
      extra: string
    }
    const result = sanitizePrompt(withExtra)
    expect(result).toEqual(validPrompt)
    expect((result as Record<string, unknown>)['extra']).toBeUndefined()
  })

  it('元のオブジェクトを変更しない（新しいオブジェクトを返す）', () => {
    const original = { ...validPrompt }
    const result = sanitizePrompt(original)
    expect(result).not.toBe(original)
  })
})
