import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  stat,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_GLOBAL_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { resolveGlobalAgentInstructionLocations } from '../globalAgentInstructionLocations'
import type { ResolvedGlobalAgentInstructionLocation } from '../globalAgentInstructionLocations'
import { GlobalAgentInstructionAccessDeniedError } from '../globalAgentInstructionAccess'
import {
  createGlobalAgentInstructionFile,
  toGlobalAgentInstructionCreateFailureReason
} from '../globalAgentInstructionFileCreator'

const itPosix = it.skipIf(process.platform === 'win32')
const TEMPLATE = AGENT_GLOBAL_INSTRUCTION_FILES.claude.template
let root: string
let home: string
let outside: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-create-')))
  home = join(root, 'home')
  outside = join(root, 'outside')
  await mkdir(home)
  await mkdir(outside)
})

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempPath(root)
})

const claudeAt = (env: NodeJS.ProcessEnv = {}): ResolvedGlobalAgentInstructionLocation => {
  const location = resolveGlobalAgentInstructionLocations({ env, homeDir: home }).claude
  if (location.kind !== 'resolved') throw new Error('unexpected unavailable')
  return location
}

describe('createGlobalAgentInstructionFile', () => {
  itPosix('フォルダが無い → 0o700 で作ってから雛形を書く', async () => {
    await createGlobalAgentInstructionFile(claudeAt(), home)
    expect((await stat(join(home, '.claude'))).mode & 0o777).toBe(0o700)
    expect(await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf-8')).toBe(TEMPLATE)
  })

  it('フォルダがある → そのまま中に書く', async () => {
    await mkdir(join(home, '.claude'))
    await createGlobalAgentInstructionFile(claudeAt(), home)
    expect(await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf-8')).toBe(TEMPLATE)
  })

  it('既にある → EEXIST で中身が変わらない', async () => {
    await mkdir(join(home, '.claude'))
    await writeFile(join(home, '.claude', 'CLAUDE.md'), 'mine')
    await expect(createGlobalAgentInstructionFile(claudeAt(), home)).rejects.toMatchObject({
      code: 'EEXIST'
    })
    expect(await readFile(join(home, '.claude', 'CLAUDE.md'), 'utf-8')).toBe('mine')
  })

  itPosix('フォルダがホームの外へのリンク → 拒否し、外に何も書かない', async () => {
    await symlink(outside, join(home, '.claude'))
    await expect(createGlobalAgentInstructionFile(claudeAt(), home)).rejects.toBeInstanceOf(
      GlobalAgentInstructionAccessDeniedError
    )
    expect(await readdir(outside)).toEqual([])
  })

  itPosix(
    '親がホームの外へのリンク(~/link/claude) → 拒否し、外にフォルダもファイルも作らない',
    async () => {
      await symlink(outside, join(home, 'link'))
      await expect(
        createGlobalAgentInstructionFile(
          claudeAt({ CLAUDE_CONFIG_DIR: join(home, 'link', 'claude') }),
          home
        )
      ).rejects.toBeInstanceOf(GlobalAgentInstructionAccessDeniedError)
      expect(await readdir(outside)).toEqual([])
    }
  )

  it('フォルダが同じ名前のファイル → ENOTDIR', async () => {
    await writeFile(join(home, '.claude'), 'file')
    await expect(createGlobalAgentInstructionFile(claudeAt(), home)).rejects.toMatchObject({
      code: 'ENOTDIR'
    })
  })

  it('設定のフォルダの親が無い → 失敗し、何も作らない', async () => {
    await expect(
      createGlobalAgentInstructionFile(claudeAt({ CLAUDE_CONFIG_DIR: join(home, 'a', 'b') }), home)
    ).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readdir(home)).toEqual([])
  })

  it('設定のフォルダがホームそのもの → フォルダを作らずにホームの直下に書く', async () => {
    await createGlobalAgentInstructionFile(claudeAt({ CLAUDE_CONFIG_DIR: home }), home)
    expect(await readdir(home)).toEqual(['CLAUDE.md'])
  })

  itPosix(
    'ファイル名の位置にぶら下がったリンク → 辿らずに EEXIST で、外に何も作らない',
    async () => {
      await mkdir(join(home, '.claude'))
      await symlink(join(outside, 'gone'), join(home, '.claude', 'CLAUDE.md'))
      await expect(createGlobalAgentInstructionFile(claudeAt(), home)).rejects.toMatchObject({
        code: 'EEXIST'
      })
      expect(await readdir(outside)).toEqual([])
    }
  )
})

describe('toGlobalAgentInstructionCreateFailureReason', () => {
  const fsError = (code: string): NodeJS.ErrnoException =>
    Object.assign(new Error(`${code}: /secret`), { code })

  it.each([
    [new GlobalAgentInstructionAccessDeniedError(), 'outside'],
    [fsError('EEXIST'), 'exists'],
    [fsError('ENOTDIR'), 'exists'],
    [fsError('EACCES'), 'failed'],
    [fsError('ENOENT'), 'failed'],
    [new Error('other'), 'failed']
  ])('%s → %s', (err, reason) => {
    expect(toGlobalAgentInstructionCreateFailureReason(err)).toBe(reason)
  })
})
