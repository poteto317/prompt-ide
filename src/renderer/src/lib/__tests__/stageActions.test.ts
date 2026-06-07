import { describe, it, expect } from 'vitest'
import { stageActionList } from '../stageActions'
import type { Stage, StageStatus } from '../../types'

function stage(status: StageStatus): Stage {
  return { id: 'refactor', status, events: [] }
}

function types(...args: Parameters<typeof stageActionList>): string[] {
  return stageActionList(...args).map((a) => a.type)
}

describe('stageActionList - once 種別', () => {
  it('未完了なら complete を表示', () => {
    expect(types(stage('not_started'), 'once', false, false)).toContain('complete')
  })

  it('完了済みなら reopen（未完了に戻す）を表示', () => {
    const result = stageActionList(stage('done'), 'once', false, false)
    expect(result.map((a) => a.type)).toEqual(['reopen'])
    expect(result[0].label).toBe('未完了に戻す')
  })

  it('未完了時は skip も表示する', () => {
    expect(types(stage('not_started'), 'once', false, false)).toEqual(['complete', 'skip'])
  })
})

describe('stageActionList - repeatable 種別', () => {
  it('完了済みなら reopen（再開する）を表示', () => {
    const result = stageActionList(stage('done'), 'repeatable', false, false)
    expect(result.map((a) => a.type)).toEqual(['reopen'])
    expect(result[0].label).toBe('再開する')
  })

  it('未完了なら complete は出さず skip のみ', () => {
    expect(types(stage('not_started'), 'repeatable', false, false)).toEqual(['skip'])
  })

  it('進行中でも complete は出さない', () => {
    expect(types(stage('in_progress'), 'repeatable', false, false)).not.toContain('complete')
  })
})

describe('stageActionList - skip の表示条件', () => {
  it('done のときは skip を表示しない', () => {
    expect(types(stage('done'), 'repeatable', false, false)).not.toContain('skip')
  })

  it('skipped のときは skip を表示しない', () => {
    expect(types(stage('skipped'), 'repeatable', false, false)).not.toContain('skip')
  })

  it('not_started のときは skip を表示する', () => {
    expect(types(stage('not_started'), 'repeatable', false, false)).toContain('skip')
  })
})

describe('stageActionList - advance の表示条件', () => {
  it('現在ステージかつ最終でなければ advance を表示', () => {
    expect(types(stage('in_progress'), 'repeatable', true, false)).toContain('advance')
  })

  it('現在ステージでも最終なら advance を表示しない', () => {
    expect(types(stage('in_progress'), 'repeatable', true, true)).not.toContain('advance')
  })

  it('現在ステージでなければ advance を表示しない', () => {
    expect(types(stage('in_progress'), 'repeatable', false, false)).not.toContain('advance')
  })
})

describe('stageActionList - revisable 種別', () => {
  // revisable 種別（plan/implement）は repeatable と同じアクションを持つ
  it('完了済みなら reopen（再開する）を表示', () => {
    const result = stageActionList(stage('done'), 'revisable', false, false)
    expect(result.map((a) => a.type)).toEqual(['reopen'])
    expect(result[0].label).toBe('再開する')
  })

  it('未完了なら complete は出さず skip のみ', () => {
    expect(types(stage('not_started'), 'revisable', false, false)).toEqual(['skip'])
  })

  it('進行中で現在ステージなら advance も表示', () => {
    expect(types(stage('in_progress'), 'revisable', true, false)).toContain('advance')
  })

  it('complete アクションを出さない（once とは異なる）', () => {
    expect(types(stage('not_started'), 'revisable', false, false)).not.toContain('complete')
    expect(types(stage('in_progress'), 'revisable', false, false)).not.toContain('complete')
  })
})

describe('stageActionList - once + skipped', () => {
  // once 種別のステージをスキップした後の挙動
  it('once + skipped では「完了にする」を表示する（スキップから完了へ移行可能）', () => {
    expect(types(stage('skipped'), 'once', false, false)).toContain('complete')
  })

  it('once + skipped では skip を表示しない', () => {
    expect(types(stage('skipped'), 'once', false, false)).not.toContain('skip')
  })

  it('once + skipped では reopen を表示しない', () => {
    expect(types(stage('skipped'), 'once', false, false)).not.toContain('reopen')
  })
})

describe('stageActionList - 表示順', () => {
  it('reopen/skip/advance の順で返す', () => {
    // not_started + current + not last: skip, advance
    expect(types(stage('not_started'), 'repeatable', true, false)).toEqual(['skip', 'advance'])
  })

  it('once 完了 + current + not last: reopen, advance', () => {
    expect(types(stage('done'), 'once', true, false)).toEqual(['reopen', 'advance'])
  })
})
