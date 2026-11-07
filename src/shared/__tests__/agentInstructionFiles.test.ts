import { describe, it, expect } from 'vitest'
import { AGENT_CLI_KINDS } from '../agentCliKinds'
import {
  AGENT_GLOBAL_INSTRUCTION_FILES,
  AGENT_INSTRUCTION_FILES,
  AGENT_INSTRUCTION_SUBFOLDER_FILES,
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

describe('AGENT_INSTRUCTION_SUBFOLDER_FILES', () => {
  it('すべての CLI の種類に名前が 1 つ以上あり、重複しない', () => {
    for (const kind of AGENT_CLI_KINDS) {
      const names = AGENT_INSTRUCTION_SUBFOLDER_FILES[kind].names.map((n) => n.name)
      expect(names.length).toBeGreaterThan(0)
      expect(new Set(names).size).toBe(names.length)
    }
  })

  it('名前は区切りや .. を含まず、説明は空でない', () => {
    for (const kind of AGENT_CLI_KINDS) {
      for (const entry of AGENT_INSTRUCTION_SUBFOLDER_FILES[kind].names) {
        expect(entry.name).not.toMatch(/[\\/]/)
        expect(entry.name).not.toBe('..')
        expect(entry.name).not.toBe('')
        expect(entry.description).not.toBe('')
      }
    }
  })

  it('claude は CLAUDE.md・CLAUDE.local.md の順で、注は無い', () => {
    expect(AGENT_INSTRUCTION_SUBFOLDER_FILES.claude).toEqual({
      names: [
        { name: 'CLAUDE.md', description: '共有の指示' },
        { name: 'CLAUDE.local.md', description: '個人の指示' }
      ],
      note: null
    })
  })

  it('copilot は AGENTS.md だけで、読まないことがある旨の注がある', () => {
    expect(AGENT_INSTRUCTION_SUBFOLDER_FILES.copilot).toEqual({
      names: [{ name: 'AGENTS.md', description: '共有の指示' }],
      note: 'GitHub Copilot CLI は、サブフォルダの AGENTS.md を読まないことがあります(このアプリはフォルダの根で CLI を起動するため)'
    })
  })
})

describe('AGENT_GLOBAL_INSTRUCTION_FILES', () => {
  it('CLI ごとに 1 つ → id が今の表の id と重ならない', () => {
    const projectIds = [...AGENT_INSTRUCTION_FILES.claude, ...AGENT_INSTRUCTION_FILES.copilot].map(
      (f) => f.id as string
    )
    const globalIds = Object.values(AGENT_GLOBAL_INSTRUCTION_FILES).map((f) => f.id as string)
    expect(globalIds).toEqual(['claude-global', 'copilot-global'])
    expect(globalIds.filter((id) => projectIds.includes(id))).toEqual([])
  })

  it('claude → CLAUDE_CONFIG_DIR・.claude・CLAUDE.md、空の値は既定にしない', () => {
    expect(AGENT_GLOBAL_INSTRUCTION_FILES.claude).toMatchObject({
      envName: 'CLAUDE_CONFIG_DIR',
      defaultDirName: '.claude',
      emptyEnvMeansDefault: false,
      fileName: 'CLAUDE.md'
    })
  })

  it('copilot → COPILOT_HOME・.copilot・copilot-instructions.md、空の値は既定', () => {
    expect(AGENT_GLOBAL_INSTRUCTION_FILES.copilot).toMatchObject({
      envName: 'COPILOT_HOME',
      defaultDirName: '.copilot',
      emptyEnvMeansDefault: true,
      fileName: 'copilot-instructions.md'
    })
  })

  it.each(['claude', 'copilot'] as const)(
    '%s → 名前に区切りが無く、雛形は # 全体の指示 で始まり改行で終わる',
    (kind) => {
      const file = AGENT_GLOBAL_INSTRUCTION_FILES[kind]
      expect(file.fileName).not.toMatch(/[/\\]/)
      expect(file.template.startsWith('# 全体の指示\n')).toBe(true)
      expect(file.template.endsWith('\n')).toBe(true)
      expect(file.description).toBe('個人の指示(全部のプロジェクトに効きます)')
    }
  )
})
