import { describe, it, expect } from 'vitest'
import { statusIcon, statusLabel } from '../statusDisplay'

describe('statusIcon', () => {
  it('done に ● を返す', () => {
    expect(statusIcon('done')).toBe('●')
  })

  it('in_progress に ◐ を返す', () => {
    expect(statusIcon('in_progress')).toBe('◐')
  })

  it('skipped に ⊘ を返す', () => {
    expect(statusIcon('skipped')).toBe('⊘')
  })

  it('not_started に ○ を返す（デフォルト）', () => {
    expect(statusIcon('not_started')).toBe('○')
  })
})

describe('statusLabel', () => {
  it('done に "完了" を返す', () => {
    expect(statusLabel('done')).toBe('完了')
  })

  it('in_progress に "進行中" を返す', () => {
    expect(statusLabel('in_progress')).toBe('進行中')
  })

  it('skipped に "スキップ" を返す', () => {
    expect(statusLabel('skipped')).toBe('スキップ')
  })

  it('not_started に "未着手" を返す（デフォルト）', () => {
    expect(statusLabel('not_started')).toBe('未着手')
  })

  it('statusIcon と statusLabel は同じステータス集合をカバーする', () => {
    const statuses = ['done', 'in_progress', 'skipped', 'not_started'] as const
    for (const s of statuses) {
      expect(statusIcon(s)).toBeTruthy()
      expect(statusLabel(s)).toBeTruthy()
    }
  })
})
