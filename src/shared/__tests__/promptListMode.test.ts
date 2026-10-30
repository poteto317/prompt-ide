import { describe, it, expect } from 'vitest'
import { DEFAULT_PROMPT_LIST_MODE, PROMPT_LIST_MODES, isPromptListMode } from '../types/settings'
import * as sharedTypes from '../types'

describe('isPromptListMode', () => {
  it.each([
    ['edit', true],
    ['view', true],
    ['', false],
    ['Edit', false],
    ['legacy', false],
    [null, false],
    [undefined, false],
    [1, false]
  ])('%s → %s', (value, expected) => {
    expect(isPromptListMode(value)).toBe(expected)
  })

  it('選べるモードは編集と表示の 2 つ', () => {
    expect(PROMPT_LIST_MODES).toEqual(['edit', 'view'])
  })

  it('既定は編集モード(今の見た目と挙動を変えない)', () => {
    expect(DEFAULT_PROMPT_LIST_MODE).toBe('edit')
  })

  it('@shared/types から同じものを再エクスポートする', () => {
    expect(sharedTypes.PROMPT_LIST_MODES).toBe(PROMPT_LIST_MODES)
    expect(sharedTypes.DEFAULT_PROMPT_LIST_MODE).toBe(DEFAULT_PROMPT_LIST_MODE)
    expect(sharedTypes.isPromptListMode).toBe(isPromptListMode)
  })
})
