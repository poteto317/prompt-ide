import { describe, it, expect } from 'vitest'
import { STAGES, STAGE_IDS } from '../stageConfig'

describe('stageConfig', () => {
  it('8 ステージが定義されている', () => {
    expect(STAGES).toHaveLength(8)
  })

  it('STAGE_IDS が STAGES の順序と一致する', () => {
    expect(STAGE_IDS).toEqual([
      'plan',
      'implement',
      'refactor',
      'localReview',
      'commit',
      'prCreate',
      'prReview',
      'prMerge'
    ])
  })

  it('STAGE_IDS は STAGES から派生している', () => {
    expect(STAGE_IDS).toEqual(STAGES.map((s) => s.id))
  })

  it('各ステージに label がある', () => {
    STAGES.forEach((s) => expect(s.label.length).toBeGreaterThan(0))
  })

  it('各ステージに有効な kind がある', () => {
    const validKinds = ['once', 'repeatable', 'revisable']
    STAGES.forEach((s) => expect(validKinds).toContain(s.kind))
  })

  it('各ステージ ID は一意', () => {
    const ids = STAGES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
