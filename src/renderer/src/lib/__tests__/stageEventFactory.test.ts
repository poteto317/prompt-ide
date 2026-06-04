import { describe, it, expect, vi, afterEach } from 'vitest'
import { createStageEvent } from '../stageEventFactory'

describe('createStageEvent', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  describe('id と occurredAt', () => {
    it('id が UUID 形式', () => {
      expect(createStageEvent().id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
      )
    })

    it('occurredAt が数値', () => {
      expect(typeof createStageEvent().occurredAt).toBe('number')
    })

    it('連続して呼ぶと異なる id になる', () => {
      expect(createStageEvent().id).not.toBe(createStageEvent().id)
    })

    it('fakeTimers で occurredAt が固定される', () => {
      vi.useFakeTimers()
      vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
      expect(createStageEvent().occurredAt).toBe(new Date('2026-01-01T00:00:00Z').getTime())
    })
  })

  describe('note', () => {
    it('note を渡すと保持される', () => {
      expect(createStageEvent('メモ').note).toBe('メモ')
    })

    it('note 未指定なら note プロパティを持たない', () => {
      expect(createStageEvent()).not.toHaveProperty('note')
    })

    it('空文字の note は省略される', () => {
      expect(createStageEvent('')).not.toHaveProperty('note')
    })

    it('空白のみの note は保持される（trim は呼び出し元の責務）', () => {
      expect(createStageEvent('   ').note).toBe('   ')
    })
  })

  describe('meta', () => {
    it('meta を渡すと保持される', () => {
      expect(createStageEvent(undefined, { commit: 'abc' }).meta).toEqual({ commit: 'abc' })
    })

    it('meta 未指定なら meta プロパティを持たない', () => {
      expect(createStageEvent()).not.toHaveProperty('meta')
    })

    it('空オブジェクトの meta は保持される', () => {
      expect(createStageEvent(undefined, {})).toHaveProperty('meta')
    })

    it('note と meta を両方渡せる', () => {
      const event = createStageEvent('メモ', { pr: '42' })
      expect(event.note).toBe('メモ')
      expect(event.meta).toEqual({ pr: '42' })
    })
  })
})
