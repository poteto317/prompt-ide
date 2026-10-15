import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// エージェントの変更の lib(純粋な関数)が hook に依存しない(依存の向き: hook → lib)。写しの型(AgentChangesView)は
// renderer の types に置き、lib はそこから読む。hook から型を読むと、hook ↔ lib の循環になる
const LIB_DIR = join(__dirname, '..')

const agentChangesLibFiles = (): string[] =>
  readdirSync(LIB_DIR).filter((name) => /^agentChanges.*\.ts$/.test(name))

describe('エージェントの変更の lib の依存の向き', () => {
  it('対象のファイルがある(検査が空振りしない)', () => {
    expect(agentChangesLibFiles()).toEqual(
      expect.arrayContaining([
        'agentChangesAvailability.ts',
        'agentChangesRevertTargets.ts',
        'agentChangesScope.ts',
        'agentChangesSectionText.ts',
        'agentChangesView.ts',
        'agentChangesWiring.ts'
      ])
    )
  })

  it.each(agentChangesLibFiles())('%s は useAgentChanges から import しない', (name) => {
    const source = readFileSync(join(LIB_DIR, name), 'utf8')
    expect(source).not.toMatch(/from '\.\.\/hooks\/useAgentChanges'/)
  })
})
