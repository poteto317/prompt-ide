import { describe, it, expect, vi, afterEach } from 'vitest'
import type { Prompt } from '../../types'
import { createPrompt, cloneAsNewPrompt } from '../promptFactory'

describe('createPrompt', () => {
  it('titleとcontentを正しく持つPromptを返す', () => {
    const prompt = createPrompt('テストタイトル', 'テスト内容')
    expect(prompt.title).toBe('テストタイトル')
    expect(prompt.content).toBe('テスト内容')
  })

  it('idがUUID形式の文字列', () => {
    const { id } = createPrompt('t', 'c')
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('同じ引数で2回呼ぶと異なるidになる', () => {
    const a = createPrompt('t', 'c')
    const b = createPrompt('t', 'c')
    expect(a.id).not.toBe(b.id)
  })

  it('createdAtがDate.now()相当の数値', () => {
    const before = Date.now()
    const { createdAt } = createPrompt('t', 'c')
    const after = Date.now()
    expect(createdAt).toBeGreaterThanOrEqual(before)
    expect(createdAt).toBeLessThanOrEqual(after)
  })

  it('createdAtはDateオブジェクトではなく数値', () => {
    const { createdAt } = createPrompt('t', 'c')
    expect(typeof createdAt).toBe('number')
  })

  it('vitest fakeTimers でcreatedAtが固定される', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2025-01-01T00:00:00Z'))
    const { createdAt } = createPrompt('t', 'c')
    expect(createdAt).toBe(new Date('2025-01-01T00:00:00Z').getTime())
  })

  afterEach(() => {
    vi.useRealTimers()
  })
})

describe('cloneAsNewPrompt', () => {
  const source: Prompt = {
    id: 'original-id',
    title: 'タイトル',
    content: '内容',
    createdAt: 1234567890,
    pinned: true,
  }

  it('id を新しい UUID に再生成する', () => {
    const cloned = cloneAsNewPrompt(source)
    expect(cloned.id).not.toBe('original-id')
    expect(cloned.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('id 以外のフィールド（title/content/createdAt/pinned）を保持する', () => {
    const cloned = cloneAsNewPrompt(source)
    expect(cloned.title).toBe('タイトル')
    expect(cloned.content).toBe('内容')
    expect(cloned.createdAt).toBe(1234567890)
    expect(cloned.pinned).toBe(true)
  })

  it('pinned が無いプロンプトでも複製できる', () => {
    const { id: _id, ...rest } = source
    const without: Prompt = { ...rest, id: 'x', pinned: undefined }
    const cloned = cloneAsNewPrompt(without)
    expect(cloned.pinned).toBeUndefined()
    expect(cloned.id).not.toBe('x')
  })

  it('同じ入力でも 2 回呼ぶと異なる id になる', () => {
    const a = cloneAsNewPrompt(source)
    const b = cloneAsNewPrompt(source)
    expect(a.id).not.toBe(b.id)
  })

  it('元のオブジェクトを破壊的に変更しない', () => {
    cloneAsNewPrompt(source)
    expect(source.id).toBe('original-id')
  })
})
