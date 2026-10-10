import { describe, it, expect } from 'vitest'
import { formatAgentTabLabel } from '../agentTabLabel'

describe('formatAgentTabLabel', () => {
  it('タブの番号から claude N を作る', () => {
    expect(formatAgentTabLabel(1)).toBe('claude 1')
    expect(formatAgentTabLabel(4)).toBe('claude 4')
  })
})
