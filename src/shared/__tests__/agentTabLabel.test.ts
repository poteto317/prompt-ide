import { describe, it, expect } from 'vitest'
import { formatAgentTabLabel } from '../agentTabLabel'

describe('formatAgentTabLabel', () => {
  it('種類のコマンド名とタブの番号から作る(claude 1・copilot 1)', () => {
    expect(formatAgentTabLabel(1, 'claude')).toBe('claude 1')
    expect(formatAgentTabLabel(4, 'claude')).toBe('claude 4')
    expect(formatAgentTabLabel(1, 'copilot')).toBe('copilot 1')
    expect(formatAgentTabLabel(3, 'copilot')).toBe('copilot 3')
  })
})
