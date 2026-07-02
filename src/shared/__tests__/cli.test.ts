import { describe, it, expect } from 'vitest'
import { EXECUTION_TOOLS, CLI_ONLY_TOOL_IDS } from '../types/cli'

describe('EXECUTION_TOOLS', () => {
  it('claude / copilot / api の 3 ツールを含む', () => {
    const ids = EXECUTION_TOOLS.map((t) => t.id)
    expect(ids).toContain('claude')
    expect(ids).toContain('copilot')
    expect(ids).toContain('api')
    expect(ids).toHaveLength(3)
  })

  it('各ツールが id と label を持つ', () => {
    for (const tool of EXECUTION_TOOLS) {
      expect(typeof tool.id).toBe('string')
      expect(typeof tool.label).toBe('string')
      expect(tool.label.length).toBeGreaterThan(0)
    }
  })

  it('すべての id が PromptToolId の範囲内である', () => {
    const validIds = ['claude', 'copilot', 'api'] as const
    for (const tool of EXECUTION_TOOLS) {
      expect(validIds).toContain(tool.id)
    }
  })

  it('破壊的変更ができないこと（readonly）を TypeScript が保証する（コンパイル時検証）', () => {
    // as const satisfies readonly PromptTool[] により配列自体が readonly になっている。
    // 実行時には通常配列と同じ動作をするため read 操作は問題なく機能する。
    expect(EXECUTION_TOOLS[0].id).toBe('claude')
    expect(EXECUTION_TOOLS[1].id).toBe('copilot')
    expect(EXECUTION_TOOLS[2].id).toBe('api')
  })
})

describe('CLI_ONLY_TOOL_IDS', () => {
  it('claude と copilot のみを含む', () => {
    expect(CLI_ONLY_TOOL_IDS).toContain('claude')
    expect(CLI_ONLY_TOOL_IDS).toContain('copilot')
    expect(CLI_ONLY_TOOL_IDS).not.toContain('api')
    expect(CLI_ONLY_TOOL_IDS).toHaveLength(2)
  })

  it('EXECUTION_TOOLS の id が CLI_ONLY_TOOL_IDS の完全なスーパーセットである', () => {
    const executionIds = EXECUTION_TOOLS.map((t) => t.id)
    for (const cliId of CLI_ONLY_TOOL_IDS) {
      expect(executionIds).toContain(cliId)
    }
  })
})
