import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '../agentCliKinds'
import {
  AGENT_INSTRUCTION_FILES,
  agentInstructionRelativePath,
  findAgentInstructionFile
} from '../agentInstructionFiles'

describe('AGENT_INSTRUCTION_FILES', () => {
  it('すべての CLI の種類に行がある → 1 件以上', () => {
    for (const kind of AGENT_CLI_KINDS) {
      expect(AGENT_INSTRUCTION_FILES[kind].length).toBeGreaterThan(0)
    }
  })

  it('id は全体で一意', () => {
    const ids = AGENT_CLI_KINDS.flatMap((kind) => AGENT_INSTRUCTION_FILES[kind].map((f) => f.id))
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('claude は CLAUDE.md・.claude/CLAUDE.md・CLAUDE.local.md の順', () => {
    expect(AGENT_INSTRUCTION_FILES.claude.map(agentInstructionRelativePath)).toEqual([
      'CLAUDE.md',
      '.claude/CLAUDE.md',
      'CLAUDE.local.md'
    ])
  })

  it('copilot は AGENTS.md・.github/copilot-instructions.md の順', () => {
    expect(AGENT_INSTRUCTION_FILES.copilot.map(agentInstructionRelativePath)).toEqual([
      'AGENTS.md',
      '.github/copilot-instructions.md'
    ])
  })

  it('segments が 2 つのときの 1 つ目は .claude か .github', () => {
    for (const kind of AGENT_CLI_KINDS) {
      for (const file of AGENT_INSTRUCTION_FILES[kind]) {
        if (file.segments.length === 2) expect(['.claude', '.github']).toContain(file.segments[0])
      }
    }
  })

  it('各 segment は区切りや .. を含まない', () => {
    for (const kind of AGENT_CLI_KINDS) {
      for (const file of AGENT_INSTRUCTION_FILES[kind]) {
        for (const segment of file.segments) {
          expect(segment).not.toMatch(/[\\/]/)
          expect(segment).not.toBe('..')
          expect(segment).not.toBe('')
        }
      }
    }
  })

  it('雛形は見出しで始まり改行で終わる。CLAUDE.local.md だけ「個人の指示」', () => {
    for (const kind of AGENT_CLI_KINDS) {
      for (const file of AGENT_INSTRUCTION_FILES[kind]) {
        const heading = file.id === 'claude-local' ? '# 個人の指示\n' : '# プロジェクトの指示\n'
        expect(file.template.startsWith(heading)).toBe(true)
        expect(file.template.endsWith('\n')).toBe(true)
        expect(file.template).toContain('## よく使うコマンド')
      }
    }
  })
})

describe('findAgentInstructionFile', () => {
  it('CLI の表にある id → その行', () => {
    expect(findAgentInstructionFile('claude', 'claude-dot')?.segments).toEqual([
      '.claude',
      'CLAUDE.md'
    ])
  })

  it('別の CLI の id → null', () => {
    expect(findAgentInstructionFile('claude', 'copilot-agents')).toBeNull()
  })

  it.each([null, undefined, 1, '', 'unknown', {}, ['claude-root']])('不正な id %p → null', (id) => {
    expect(findAgentInstructionFile('claude', id)).toBeNull()
  })
})
