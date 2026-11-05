import { describe, expect, it } from 'vitest'
import type { FileTreeNode } from '../../types'
import { findAgentInstructionFileNode } from '../agentInstructionFileLookup'

const tree: FileTreeNode[] = [
  {
    name: '.claude',
    path: '/p/.claude',
    type: 'directory',
    children: [{ name: 'CLAUDE.md', path: '/p/.claude/CLAUDE.md', type: 'file' }]
  },
  { name: '.github', path: '/p/.github', type: 'file' },
  { name: 'AGENTS.md', path: '/p/AGENTS.md', type: 'directory', children: [] },
  { name: 'CLAUDE.md', path: '/p/CLAUDE.md', type: 'file' },
  { name: 'claude.local.md', path: '/p/claude.local.md', type: 'file' }
]

describe('findAgentInstructionFileNode', () => {
  it('根のファイル → そのノード', () => {
    expect(findAgentInstructionFileNode(tree, ['CLAUDE.md'])?.path).toBe('/p/CLAUDE.md')
  })

  it('入れ子のファイル → そのノード', () => {
    expect(findAgentInstructionFileNode(tree, ['.claude', 'CLAUDE.md'])?.path).toBe(
      '/p/.claude/CLAUDE.md'
    )
  })

  it('同じ名前のフォルダ → null', () => {
    expect(findAgentInstructionFileNode(tree, ['AGENTS.md'])).toBeNull()
  })

  it('途中がファイル → null', () => {
    expect(findAgentInstructionFileNode(tree, ['.github', 'copilot-instructions.md'])).toBeNull()
  })

  it('大文字小文字だけ違う → null(完全一致。L-009)', () => {
    expect(findAgentInstructionFileNode(tree, ['CLAUDE.local.md'])).toBeNull()
  })

  it('空のツリー → null', () => {
    expect(findAgentInstructionFileNode([], ['CLAUDE.md'])).toBeNull()
  })

  it('children の無いフォルダ → null', () => {
    const noChildren: FileTreeNode[] = [{ name: '.claude', path: '/p/.claude', type: 'directory' }]
    expect(findAgentInstructionFileNode(noChildren, ['.claude', 'CLAUDE.md'])).toBeNull()
  })
})
