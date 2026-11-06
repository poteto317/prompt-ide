import { describe, it, expect } from 'vitest'
import {
  AGENT_PERMISSION_OPTION_NUMBER_MAX,
  isAgentPermissionOptionNumber
} from '../agentPermissionAnswer'

describe('isAgentPermissionOptionNumber', () => {
  it('上限は 9(copilot は 10 以上の選択肢で 1 桁目の後に待つため。設計書「調べて分かったこと」)', () => {
    expect(AGENT_PERMISSION_OPTION_NUMBER_MAX).toBe(9)
  })

  it.each([1, 2, 5, 9])('%d は番号', (value) => {
    expect(isAgentPermissionOptionNumber(value)).toBe(true)
  })

  it.each([0, 10, 1.5, -1, NaN, Infinity, -Infinity, '1', null, undefined, {}, [1], true])(
    '%o は番号でない',
    (value) => {
      expect(isAgentPermissionOptionNumber(value)).toBe(false)
    }
  )
})
