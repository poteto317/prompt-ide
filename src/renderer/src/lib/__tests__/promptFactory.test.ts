import { describe, it, expect, vi, afterEach } from 'vitest'
import { createPrompt } from '../promptFactory'

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
