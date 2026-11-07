import { describe, expect, it } from 'vitest'
import { toAgentGlobalInstructionRow, toGlobalInstructionNode } from '../agentGlobalInstructionRow'
import {
  AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME,
  AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED,
  agentGlobalInstructionUnavailableMessage
} from '../agentInstructionMessages'

const DESCRIPTION = '個人の指示(全部のプロジェクトに効きます)'

describe('toAgentGlobalInstructionRow', () => {
  it('まだ問い合わせていない → loading', () => {
    expect(toAgentGlobalInstructionRow(null, 'claude')).toEqual({ kind: 'loading' })
  })

  it('持っている CLI の種類が今と違う → loading(前の CLI の行を出さない)', () => {
    expect(
      toAgentGlobalInstructionRow(
        { cliKind: 'claude', status: { kind: 'missing', displayPath: '~/.claude/CLAUDE.md' } },
        'copilot'
      )
    ).toEqual({ kind: 'loading' })
  })

  it('exists → ノードを持ち、ノードの name が displayPath', () => {
    const row = toAgentGlobalInstructionRow(
      {
        cliKind: 'claude',
        status: {
          kind: 'exists',
          filePath: '/home/u/.claude/CLAUDE.md',
          displayPath: '~/.claude/CLAUDE.md'
        }
      },
      'claude'
    )
    expect(row).toEqual({
      kind: 'exists',
      displayPath: '~/.claude/CLAUDE.md',
      description: DESCRIPTION,
      node: { type: 'file', name: '~/.claude/CLAUDE.md', path: '/home/u/.claude/CLAUDE.md' }
    })
  })

  it('missing → ノードを持たない', () => {
    expect(
      toAgentGlobalInstructionRow(
        {
          cliKind: 'copilot',
          status: { kind: 'missing', displayPath: '~/.copilot/copilot-instructions.md' }
        },
        'copilot'
      )
    ).toEqual({
      kind: 'missing',
      displayPath: '~/.copilot/copilot-instructions.md',
      description: DESCRIPTION
    })
  })

  it.each([
    [
      { kind: 'linkOutsideHome', displayPath: '~/.claude/CLAUDE.md' } as const,
      '~/.claude/CLAUDE.md',
      AGENT_GLOBAL_INSTRUCTION_LINK_OUTSIDE_HOME
    ],
    [
      { kind: 'failed', displayPath: '~/.claude/CLAUDE.md' } as const,
      '~/.claude/CLAUDE.md',
      AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED
    ],
    ['queryFailed' as const, null, AGENT_GLOBAL_INSTRUCTION_STATUS_FAILED],
    [
      { kind: 'unavailable', reason: 'envNotAbsolute' } as const,
      null,
      agentGlobalInstructionUnavailableMessage('envNotAbsolute', 'CLAUDE_CONFIG_DIR')
    ],
    [
      { kind: 'unavailable', reason: 'envOutsideHome' } as const,
      null,
      agentGlobalInstructionUnavailableMessage('envOutsideHome', 'CLAUDE_CONFIG_DIR')
    ]
  ])('%o → blocked と文言', (status, displayPath, message) => {
    expect(toAgentGlobalInstructionRow({ cliKind: 'claude', status }, 'claude')).toEqual({
      kind: 'blocked',
      displayPath,
      message
    })
  })

  it('環境変数の文言 → 表の envName を入れ、値は入れない', () => {
    expect(agentGlobalInstructionUnavailableMessage('envNotAbsolute', 'CLAUDE_CONFIG_DIR')).toBe(
      'CLAUDE_CONFIG_DIR が絶対パスでないため、全体の指示ファイルの場所を決められません'
    )
    expect(agentGlobalInstructionUnavailableMessage('envOutsideHome', 'COPILOT_HOME')).toBe(
      'COPILOT_HOME がホームフォルダの外を指すため、全体の指示ファイルを扱えません'
    )
  })
})

describe('toGlobalInstructionNode', () => {
  it('exists の状態 → ファイルのノード', () => {
    expect(
      toGlobalInstructionNode({
        kind: 'exists',
        filePath: '/h/.claude/CLAUDE.md',
        displayPath: '~/.claude/CLAUDE.md'
      })
    ).toEqual({ type: 'file', name: '~/.claude/CLAUDE.md', path: '/h/.claude/CLAUDE.md' })
  })
})
