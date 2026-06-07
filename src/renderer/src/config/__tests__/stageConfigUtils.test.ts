import { describe, it, expect } from 'vitest'
import { getStageDefinition, getStageIndex } from '../stageConfigUtils'
import { STAGES } from '../stageConfig'

describe('getStageDefinition', () => {
  it('plan の定義を返す', () => {
    const def = getStageDefinition('plan')
    expect(def.id).toBe('plan')
    expect(def.kind).toBe('revisable')
  })

  it('prMerge の定義を返す', () => {
    const def = getStageDefinition('prMerge')
    expect(def.id).toBe('prMerge')
    expect(def.kind).toBe('once')
  })

  it('全8ステージのIDで例外を投げない', () => {
    for (const stage of STAGES) {
      expect(() => getStageDefinition(stage.id)).not.toThrow()
    }
  })

  it('未知の ID では例外をスロー', () => {
    expect(() => getStageDefinition('unknown' as never)).toThrow('未知のステージ: unknown')
  })

  it('返却されたオブジェクトに id, label, kind が含まれる', () => {
    const def = getStageDefinition('commit')
    expect(def).toHaveProperty('id')
    expect(def).toHaveProperty('label')
    expect(def).toHaveProperty('kind')
  })
})

describe('getStageIndex', () => {
  it('plan は index 0', () => {
    expect(getStageIndex('plan')).toBe(0)
  })

  it('prMerge は index 7（最後）', () => {
    expect(getStageIndex('prMerge')).toBe(7)
  })

  it('全ステージで 0 以上のインデックスを返す', () => {
    for (const stage of STAGES) {
      expect(getStageIndex(stage.id)).toBeGreaterThanOrEqual(0)
    }
  })

  it('未知の ID では -1 を返す', () => {
    expect(getStageIndex('unknown' as never)).toBe(-1)
  })

  it('STAGES の順序どおりのインデックスを返す', () => {
    STAGES.forEach((stage, i) => {
      expect(getStageIndex(stage.id)).toBe(i)
    })
  })
})
