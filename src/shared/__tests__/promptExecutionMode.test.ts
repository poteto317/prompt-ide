import { describe, it, expect } from 'vitest'
import { DEFAULT_PROMPT_EXECUTION_MODE, isPromptExecutionMode } from '../types/settings'

describe('isPromptExecutionMode', () => {
  it.each([
    ['agent-cli', true],
    ['legacy', true],
    ['', false],
    ['Legacy', false],
    [null, false],
    [1, false]
  ])('%s → %s', (value, expected) => {
    expect(isPromptExecutionMode(value)).toBe(expected)
  })

  it('既定はエージェント CLI 方式', () => {
    expect(DEFAULT_PROMPT_EXECUTION_MODE).toBe('agent-cli')
  })
})
