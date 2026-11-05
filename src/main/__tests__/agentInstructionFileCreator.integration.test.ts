import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FolderAccessManager, FolderAccessDeniedError } from '../folderAccessManager'
import { createAgentInstructionFile } from '../agentInstructionFileCreator'
import { AGENT_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import type { AgentInstructionFile } from '@shared/agentInstructionFiles'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'

const fileOf = (id: AgentInstructionFile['id']): AgentInstructionFile => {
  const found = [...AGENT_INSTRUCTION_FILES.claude, ...AGENT_INSTRUCTION_FILES.copilot].find(
    (f) => f.id === id
  )
  if (found === undefined) throw new Error(`no file: ${id}`)
  return found
}

let root: string
let folder: string
let outside: string
const access = new FolderAccessManager()
const itSymlink = it.skipIf(process.platform === 'win32')

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'agent-instructions-')))
  folder = join(root, 'project')
  outside = join(root, 'outside')
  await mkdir(folder)
  await mkdir(outside)
})

afterEach(async () => {
  await removeTempPath(root)
})

describe('createAgentInstructionFile', () => {
  it('CLAUDE.md が無い → 雛形で作る', async () => {
    await createAgentInstructionFile(folder, access, fileOf('claude-root'))
    expect(await readFile(join(folder, 'CLAUDE.md'), 'utf-8')).toBe(fileOf('claude-root').template)
  })

  it('.claude が無い → フォルダも作って .claude/CLAUDE.md を書く', async () => {
    await createAgentInstructionFile(folder, access, fileOf('claude-dot'))
    expect(await readFile(join(folder, '.claude', 'CLAUDE.md'), 'utf-8')).toBe(
      fileOf('claude-dot').template
    )
  })

  it('.claude が既にある → そのまま中に作る', async () => {
    await mkdir(join(folder, '.claude'))
    await writeFile(join(folder, '.claude', 'settings.json'), '{}')
    await createAgentInstructionFile(folder, access, fileOf('claude-dot'))
    expect((await readdir(join(folder, '.claude'))).sort()).toEqual(['CLAUDE.md', 'settings.json'])
  })

  it('既にある → EEXIST で失敗し、中身は変わらない', async () => {
    await writeFile(join(folder, 'AGENTS.md'), 'mine')
    await expect(
      createAgentInstructionFile(folder, access, fileOf('copilot-agents'))
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readFile(join(folder, 'AGENTS.md'), 'utf-8')).toBe('mine')
  })

  itSymlink(
    '.claude がフォルダの中のフォルダへのリンク → リンク先に雛形で作る(書く先は許可フォルダの中)',
    async () => {
      const shared = join(folder, 'shared')
      await mkdir(shared)
      await symlink(shared, join(folder, '.claude'))
      await createAgentInstructionFile(folder, access, fileOf('claude-dot'))
      expect(await readFile(join(shared, 'CLAUDE.md'), 'utf-8')).toBe(fileOf('claude-dot').template)
      expect(await readdir(outside)).toEqual([])
    }
  )

  itSymlink(
    '.claude がフォルダの外へのリンク → FolderAccessDeniedError で、外に何も作らない',
    async () => {
      await symlink(outside, join(folder, '.claude'))
      await expect(
        createAgentInstructionFile(folder, access, fileOf('claude-dot'))
      ).rejects.toBeInstanceOf(FolderAccessDeniedError)
      expect(await readdir(outside)).toEqual([])
    }
  )

  it('.claude が同名のファイル → ENOTDIR で失敗し、ファイルは変わらない', async () => {
    await writeFile(join(folder, '.claude'), 'file')
    await expect(
      createAgentInstructionFile(folder, access, fileOf('claude-dot'))
    ).rejects.toMatchObject({ code: 'ENOTDIR' })
    expect(await readFile(join(folder, '.claude'), 'utf-8')).toBe('file')
  })

  itSymlink('CLAUDE.md がぶら下がったリンク → EEXIST で、リンク先を作らない', async () => {
    const target = join(outside, 'created.md')
    await symlink(target, join(folder, 'CLAUDE.md'))
    await expect(
      createAgentInstructionFile(folder, access, fileOf('claude-root'))
    ).rejects.toMatchObject({ code: 'EEXIST' })
    expect(await readdir(outside)).toEqual([])
  })

  itSymlink('.claude がぶら下がったリンク → ENOENT で失敗し、外に何も作らない', async () => {
    await symlink(join(outside, 'missing'), join(folder, '.claude'))
    await expect(
      createAgentInstructionFile(folder, access, fileOf('claude-dot'))
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(outside)).toEqual([])
  })
})
