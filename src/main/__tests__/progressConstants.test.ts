import { describe, it, expect } from 'vitest'
import { STAGE_IDS, STAGE_STATUSES } from '../progressConstants'

describe('STAGE_IDS', () => {
  it('8つのステージIDを含む', () => {
    expect(STAGE_IDS).toHaveLength(8)
  })

  it('全ての既知ステージIDを含む', () => {
    expect(STAGE_IDS).toContain('plan')
    expect(STAGE_IDS).toContain('implement')
    expect(STAGE_IDS).toContain('refactor')
    expect(STAGE_IDS).toContain('localReview')
    expect(STAGE_IDS).toContain('commit')
    expect(STAGE_IDS).toContain('prCreate')
    expect(STAGE_IDS).toContain('prReview')
    expect(STAGE_IDS).toContain('prMerge')
  })

  it('未知の文字列を含まない', () => {
    expect(STAGE_IDS).not.toContain('unknown')
    expect(STAGE_IDS).not.toContain('')
  })

  it('重複を含まない', () => {
    expect(new Set(STAGE_IDS).size).toBe(STAGE_IDS.length)
  })
})

describe('STAGE_STATUSES', () => {
  it('4つのステータスを含む', () => {
    expect(STAGE_STATUSES).toHaveLength(4)
  })

  it('全ての既知ステータスを含む', () => {
    expect(STAGE_STATUSES).toContain('not_started')
    expect(STAGE_STATUSES).toContain('in_progress')
    expect(STAGE_STATUSES).toContain('done')
    expect(STAGE_STATUSES).toContain('skipped')
  })

  it('未知の文字列を含まない', () => {
    expect(STAGE_STATUSES).not.toContain('pending')
    expect(STAGE_STATUSES).not.toContain('')
  })

  it('重複を含まない', () => {
    expect(new Set(STAGE_STATUSES).size).toBe(STAGE_STATUSES.length)
  })
})
