import { describe, expect, it } from 'vitest'
import {
  AGENT_INSTRUCTION_FILES,
  AGENT_INSTRUCTION_SUBFOLDER_FILES
} from '@shared/agentInstructionFiles'
import type { FileTreeNode } from '../../types'
import {
  AGENT_INSTRUCTION_SUBFOLDER_LIMIT,
  findAgentInstructionSubfolderFiles
} from '../agentInstructionSubfolderLookup'

const file = (path: string): FileTreeNode => ({
  name: path.split('/').pop() ?? '',
  path,
  type: 'file'
})
const dir = (path: string, children: FileTreeNode[]): FileTreeNode => ({
  name: path.split('/').pop() ?? '',
  path,
  type: 'directory',
  children
})

const claude = AGENT_INSTRUCTION_SUBFOLDER_FILES.claude
const claudeExcluded = AGENT_INSTRUCTION_FILES.claude.map((f) => f.segments)
const paths = (tree: FileTreeNode[]): string[] =>
  findAgentInstructionSubfolderFiles(tree, claude, claudeExcluded).rows.map((r) => r.relativePath)

describe('findAgentInstructionSubfolderFiles', () => {
  it('根の直下のファイル → 含めない(このフォルダの分)', () => {
    // 除外の表が空でも、根のファイルは出さない(除外の表に頼らない)
    const result = findAgentInstructionSubfolderFiles(
      [file('/p/CLAUDE.md'), file('/p/CLAUDE.local.md')],
      claude,
      []
    )
    expect(result.rows).toEqual([])
    expect(result.total).toBe(0)
  })

  it('入れ子のファイル → 相対パスを / でつなぎ、表の説明を付ける', () => {
    const result = findAgentInstructionSubfolderFiles(
      [dir('/p/src', [dir('/p/src/sub', [file('/p/src/sub/CLAUDE.local.md')])])],
      claude,
      claudeExcluded
    )
    expect(result.rows).toEqual([
      {
        relativePath: 'src/sub/CLAUDE.local.md',
        description: '個人の指示',
        node: file('/p/src/sub/CLAUDE.local.md')
      }
    ])
    expect(result.total).toBe(1)
  })

  it('今の表の位置(根の .claude/CLAUDE.md) → 除く。サブフォルダの src/.claude/CLAUDE.md は根の位置でないので出る', () => {
    expect(
      paths([
        dir('/p/.claude', [file('/p/.claude/CLAUDE.md')]),
        dir('/p/src', [dir('/p/src/.claude', [file('/p/src/.claude/CLAUDE.md')])])
      ])
    ).toEqual(['src/.claude/CLAUDE.md'])
  })

  it('大文字小文字だけ違う名前・同じ名前のフォルダ → 出さない(完全一致。L-009)', () => {
    expect(paths([dir('/p/src', [file('/p/src/claude.md'), dir('/p/src/CLAUDE.md', [])])])).toEqual(
      []
    )
  })

  it('並べ方 → 祖先のフォルダが先、同じフォルダは表の順、兄弟は localeCompare の順', () => {
    // ツリーの順(フォルダが先)のままだと src/sub が src の直下のファイルより先に来る
    const tree = [
      dir('/p/src', [
        dir('/p/src/sub', [file('/p/src/sub/CLAUDE.md')]),
        file('/p/src/CLAUDE.local.md'),
        file('/p/src/CLAUDE.md')
      ]),
      dir('/p/b', [file('/p/b/CLAUDE.md')]),
      dir('/p/a', [file('/p/a/CLAUDE.md')])
    ]
    expect(paths(tree)).toEqual([
      'a/CLAUDE.md',
      'b/CLAUDE.md',
      'src/CLAUDE.md',
      'src/CLAUDE.local.md',
      'src/sub/CLAUDE.md'
    ])
  })

  it('上限を超える → 上限までに切り、total は全件', () => {
    const many = Array.from({ length: AGENT_INSTRUCTION_SUBFOLDER_LIMIT + 1 }, (_, i) => {
      const name = `m${String(i).padStart(2, '0')}`
      return dir(`/p/${name}`, [file(`/p/${name}/CLAUDE.md`)])
    })
    const result = findAgentInstructionSubfolderFiles(many, claude, claudeExcluded)
    expect(result.rows).toHaveLength(50)
    expect(result.total).toBe(51)
    expect(result.rows[0].relativePath).toBe('m00/CLAUDE.md')
  })

  it('上限ちょうど → すべて出し、total も同じ', () => {
    const many = Array.from({ length: 50 }, (_, i) => dir(`/p/m${i}`, [file(`/p/m${i}/CLAUDE.md`)]))
    const result = findAgentInstructionSubfolderFiles(many, claude, claudeExcluded)
    expect(result.rows).toHaveLength(50)
    expect(result.total).toBe(50)
  })

  it('空のツリー・children の無いフォルダ → 0 件', () => {
    expect(findAgentInstructionSubfolderFiles([], claude, claudeExcluded)).toEqual({
      rows: [],
      total: 0
    })
    expect(paths([{ name: 'src', path: '/p/src', type: 'directory' }])).toEqual([])
  })

  it('相対パスはノードの path ではなくたどった名前から作る', () => {
    // path の書き方が根と違っても(realpath の違いなど)、相対パスは名前でつなぐ
    const odd: FileTreeNode = { name: 'CLAUDE.md', path: '/private/x/y/CLAUDE.md', type: 'file' }
    expect(paths([dir('/p/src', [odd])])).toEqual(['src/CLAUDE.md'])
  })

  it('copilot → AGENTS.md だけを集める', () => {
    const result = findAgentInstructionSubfolderFiles(
      [dir('/p/src', [file('/p/src/AGENTS.md'), file('/p/src/CLAUDE.md')])],
      AGENT_INSTRUCTION_SUBFOLDER_FILES.copilot,
      AGENT_INSTRUCTION_FILES.copilot.map((f) => f.segments)
    )
    expect(result.rows.map((r) => r.relativePath)).toEqual(['src/AGENTS.md'])
  })
})
