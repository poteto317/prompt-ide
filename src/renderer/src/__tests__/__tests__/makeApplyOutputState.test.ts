import { describe, it, expect, vi } from 'vitest'
import { TEST_REASON_ID, makeApplyOutputState, makeApplyActions } from '../makeApplyOutputState'

describe('makeApplyOutputState', () => {
  it('既定は、挿入も置換もできて通知なし。apply はモック', () => {
    const state = makeApplyOutputState()

    expect(state.insertDisabledReason).toBeNull()
    expect(state.replaceDisabledReason).toBeNull()
    expect(state.notice).toBeNull()
    expect(vi.isMockFunction(state.apply)).toBe(true)
  })

  it('指定した項目だけを上書きする', () => {
    const state = makeApplyOutputState({ replaceDisabledReason: '理由' })

    expect(state.replaceDisabledReason).toBe('理由')
    expect(state.insertDisabledReason).toBeNull()
  })
})

describe('makeApplyActions', () => {
  it('既定は makeApplyOutputState と同じ可否で、reasonId は TEST_REASON_ID。apply はモック', () => {
    const actions = makeApplyActions()

    expect(actions).toEqual({
      insertDisabledReason: null,
      replaceDisabledReason: null,
      apply: expect.any(Function),
      reasonId: TEST_REASON_ID
    })
    expect(vi.isMockFunction(actions.apply)).toBe(true)
  })

  it('指定した項目だけを上書きする(reasonId も上書きできる)', () => {
    const actions = makeApplyActions({ insertDisabledReason: '理由', reasonId: 'other' })

    expect(actions.insertDisabledReason).toBe('理由')
    expect(actions.replaceDisabledReason).toBeNull()
    expect(actions.reasonId).toBe('other')
  })

  it('呼ぶたびに別の apply のモックを作る(テストの間で呼び出し履歴を共有しない)', () => {
    expect(makeApplyActions().apply).not.toBe(makeApplyActions().apply)
  })
})
