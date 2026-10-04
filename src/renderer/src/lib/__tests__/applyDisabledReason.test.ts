import { describe, it, expect } from 'vitest'
import {
  APPLY_DISABLED_REASONS,
  getApplyDisabledReasons,
  getShownDisabledReason
} from '../applyDisabledReason'

describe('getApplyDisabledReasons', () => {
  const { noEditor, executing, noSelection } = APPLY_DISABLED_REASONS
  // 優先順位は エディタが無い > 実行中 > 選択範囲が無い(置換だけ)
  it.each([
    [false, false, false, noEditor, noEditor],
    [false, false, true, noEditor, noEditor],
    [false, true, false, noEditor, noEditor],
    [false, true, true, noEditor, noEditor],
    [true, true, false, executing, executing],
    [true, true, true, executing, executing],
    [true, false, false, null, noSelection],
    [true, false, true, null, null]
  ])(
    'hasTarget=%s isExecuting=%s hasSelection=%s → 挿入 %s / 置換 %s',
    (hasTarget, isExecuting, hasSelection, insert, replace) => {
      expect(getApplyDisabledReasons({ hasTarget, isExecuting, hasSelection })).toEqual({
        insert,
        replace
      })
    }
  )
})

describe('getShownDisabledReason', () => {
  it('どちらも有効なら null(理由の要素を出さない)', () => {
    expect(
      getShownDisabledReason({ insertDisabledReason: null, replaceDisabledReason: null })
    ).toBeNull()
  })

  it('置換だけが無効なら、置換の理由', () => {
    expect(
      getShownDisabledReason({ insertDisabledReason: null, replaceDisabledReason: '置換の理由' })
    ).toBe('置換の理由')
  })

  it('挿入だけが無効なら、挿入の理由(無効なボタンの参照先が必ずある)', () => {
    expect(
      getShownDisabledReason({ insertDisabledReason: '挿入の理由', replaceDisabledReason: null })
    ).toBe('挿入の理由')
  })

  it('両方が無効なら、置換の理由(getApplyDisabledReasons では挿入の理由と同じ)', () => {
    expect(
      getShownDisabledReason({
        insertDisabledReason: '挿入の理由',
        replaceDisabledReason: '置換の理由'
      })
    ).toBe('置換の理由')
  })
})
