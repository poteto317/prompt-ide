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

  it('pinned が boolean の場合は有効', () => {
    expect(isValidPrompt({ ...validPrompt, pinned: true })).toBe(true)
    expect(isValidPrompt({ ...validPrompt, pinned: false })).toBe(true)
  })

  it('pinned が boolean 以外の場合は無効', () => {
    expect(isValidPrompt({ ...validPrompt, pinned: 'true' })).toBe(false)
    expect(isValidPrompt({ ...validPrompt, pinned: 1 })).toBe(false)
  })

  it('pinned が無い場合も有効（後方互換）', () => {
    expect(isValidPrompt(validPrompt)).toBe(true)
  })

  it('tags が string[] のとき有効', () => {
    expect(isValidPrompt({ ...validPrompt, tags: ['React', 'TypeScript'] })).toBe(true)
    expect(isValidPrompt({ ...validPrompt, tags: [] })).toBe(true)
  })

  it('tags が無い場合も有効（後方互換）', () => {
    expect(isValidPrompt(validPrompt)).toBe(true)
  })

  it('tags が string[] 以外のとき無効', () => {
    expect(isValidPrompt({ ...validPrompt, tags: 'React' })).toBe(false)
    expect(isValidPrompt({ ...validPrompt, tags: [1, 2] })).toBe(false)
    expect(isValidPrompt({ ...validPrompt, tags: null })).toBe(false)
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

  it('pinned が boolean のとき保持する', () => {
    expect(sanitizePrompt({ ...validPrompt, pinned: true })).toEqual({
      ...validPrompt,
      pinned: true
    })
    expect(sanitizePrompt({ ...validPrompt, pinned: false })).toEqual({
      ...validPrompt,
      pinned: false
    })
  })

  it('pinned が無いときは付与しない（未ピン扱い）', () => {
    const result = sanitizePrompt(validPrompt)
    expect('pinned' in result).toBe(false)
  })

  it('tags が有効な string[] のとき保持する', () => {
    expect(sanitizePrompt({ ...validPrompt, tags: ['React', 'TypeScript'] })).toEqual({
      ...validPrompt,
      tags: ['React', 'TypeScript'],
    })
  })

  it('tags が無いときは付与しない', () => {
    const result = sanitizePrompt(validPrompt)
    expect('tags' in result).toBe(false)
  })

  it('tags が空配列のときは付与しない', () => {
    const result = sanitizePrompt({ ...validPrompt, tags: [] })
    expect('tags' in result).toBe(false)
  })

  it('tags の前後スペースをトリムする', () => {
    expect(sanitizePrompt({ ...validPrompt, tags: [' React ', ' TypeScript '] })).toEqual({
      ...validPrompt,
      tags: ['React', 'TypeScript'],
    })
  })

  it('tags の空文字列（trim後）を除去する', () => {
    const result = sanitizePrompt({ ...validPrompt, tags: ['React', '   ', 'TypeScript'] })
    expect(result.tags).toEqual(['React', 'TypeScript'])
  })

  it('tags の重複を除去する', () => {
    expect(sanitizePrompt({ ...validPrompt, tags: ['React', 'TypeScript', 'React'] })).toEqual({
      ...validPrompt,
      tags: ['React', 'TypeScript'],
    })
  })

  it('trim・重複排除後に空になるとき tags を付与しない', () => {
    const result = sanitizePrompt({ ...validPrompt, tags: ['  ', ''] })
    expect('tags' in result).toBe(false)
  })
})
