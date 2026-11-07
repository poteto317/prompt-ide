import { chmod, mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { resolveGlobalAgentInstructionLocations } from '../globalAgentInstructionLocations'
import { getGlobalAgentInstructionStatus } from '../globalAgentInstructionStatus'

const itPosix = it.skipIf(process.platform === 'win32')
// root はパーミッションを無視して読めてしまうので、chmod 000 のテストは root では飛ばす
const itPosixNonRoot = it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)
let root: string
let home: string
let outside: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-status-')))
  home = join(root, 'home')
  outside = join(root, 'outside')
  await mkdir(home)
  await mkdir(outside)
})

afterEach(async () => {
  // chmod 000 にしたフォルダが残っていても消せるよう戻す
  await chmod(join(home, '.claude'), 0o700).catch(() => undefined)
  await removeTempPath(root)
})

const statusOf = (
  env: NodeJS.ProcessEnv = {}
): ReturnType<typeof getGlobalAgentInstructionStatus> =>
  getGlobalAgentInstructionStatus(
    resolveGlobalAgentInstructionLocations({ env, homeDir: home }).claude,
    home
  )

describe('getGlobalAgentInstructionStatus', () => {
  it('ファイルがある → exists と filePath・displayPath', async () => {
    await mkdir(join(home, '.claude'))
    await writeFile(join(home, '.claude', 'CLAUDE.md'), 'x')
    await expect(statusOf()).resolves.toEqual({
      kind: 'exists',
      filePath: join(home, '.claude', 'CLAUDE.md'),
      displayPath: '~/.claude/CLAUDE.md'
    })
  })

  it('フォルダはあるがファイルが無い → missing(filePath を含まない)', async () => {
    await mkdir(join(home, '.claude'))
    await expect(statusOf()).resolves.toEqual({
      kind: 'missing',
      displayPath: '~/.claude/CLAUDE.md'
    })
  })

  it('フォルダも無く、親(ホーム)がある → missing', async () => {
    await expect(statusOf()).resolves.toEqual({
      kind: 'missing',
      displayPath: '~/.claude/CLAUDE.md'
    })
  })

  itPosix('ファイルがホームの外を指すリンク → linkOutsideHome', async () => {
    await mkdir(join(home, '.claude'))
    await writeFile(join(outside, 'CLAUDE.md'), 'secret')
    await symlink(join(outside, 'CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'))
    await expect(statusOf()).resolves.toEqual({
      kind: 'linkOutsideHome',
      displayPath: '~/.claude/CLAUDE.md'
    })
  })

  itPosix(
    '設定のフォルダがホームの外へのリンクで中にファイルが無い → linkOutsideHome(missing にならない)',
    async () => {
      await symlink(outside, join(home, '.claude'))
      await expect(statusOf()).resolves.toMatchObject({ kind: 'linkOutsideHome' })
    }
  )

  itPosix('設定のフォルダが無く、親がホームの外へのリンク → linkOutsideHome', async () => {
    await symlink(outside, join(home, 'link'))
    await expect(
      statusOf({ CLAUDE_CONFIG_DIR: join(home, 'link', 'claude') })
    ).resolves.toMatchObject({
      kind: 'linkOutsideHome'
    })
  })

  it('設定のフォルダの親も無い → failed', async () => {
    await expect(statusOf({ CLAUDE_CONFIG_DIR: join(home, 'a', 'b') })).resolves.toMatchObject({
      kind: 'failed'
    })
  })

  itPosix('設定のフォルダがぶら下がったリンク → failed(missing にならない)', async () => {
    await symlink(join(outside, 'gone'), join(home, '.claude'))
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  itPosix('ファイルがぶら下がったリンク → failed', async () => {
    await mkdir(join(home, '.claude'))
    await symlink(join(home, 'gone.md'), join(home, '.claude', 'CLAUDE.md'))
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  itPosix('ファイルが自分を指すリンク(ELOOP) → failed', async () => {
    await mkdir(join(home, '.claude'))
    await symlink(join(home, '.claude', 'CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'))
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  it('CLAUDE.md という名前のフォルダ → failed', async () => {
    await mkdir(join(home, '.claude', 'CLAUDE.md'), { recursive: true })
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  itPosixNonRoot('読めない設定のフォルダ(chmod 000) → failed', async () => {
    await mkdir(join(home, '.claude'))
    await chmod(join(home, '.claude'), 0o000)
    await expect(statusOf()).resolves.toMatchObject({ kind: 'failed' })
  })

  it('場所を決められない → unavailable と理由', async () => {
    await expect(statusOf({ CLAUDE_CONFIG_DIR: 'rel' })).resolves.toEqual({
      kind: 'unavailable',
      reason: 'envNotAbsolute'
    })
  })
})
