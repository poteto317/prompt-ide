import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AGENT_CLI_KINDS } from '@shared/agentCliKinds'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { resolveGlobalAgentInstructionLocations } from '../globalAgentInstructionLocations'
import {
  GlobalAgentInstructionAccessDeniedError,
  assertResolvedWithinHome,
  matchGlobalAgentInstructionPath
} from '../globalAgentInstructionAccess'

const itSymlink = it.skipIf(process.platform === 'win32')
let root: string
let home: string
let outside: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-instructions-')))
  home = join(root, 'home')
  outside = join(root, 'outside')
  await mkdir(home)
  await mkdir(outside)
})

afterEach(async () => {
  await removeTempPath(root)
})

describe('matchGlobalAgentInstructionPath', () => {
  it.each(AGENT_CLI_KINDS)('main が作った %s の filePath と完全一致 → その場所', (kind) => {
    const locations = resolveGlobalAgentInstructionLocations({ env: {}, homeDir: home })
    const location = locations[kind]
    if (location.kind !== 'resolved') throw new Error('resolved のはず')
    expect(matchGlobalAgentInstructionPath(locations, location.filePath)).toBe(location)
  })

  it.each([
    ['末尾に区切り', (h: string) => join(h, '.claude', 'CLAUDE.md') + '/'],
    ['大文字小文字の違い', (h: string) => join(h, '.claude', 'claude.md')],
    // join は .. を畳むので、文字列で組み立てる(畳まれると完全一致してテストにならない)
    ['.. を含む書き方', (h: string) => `${h}/.claude/x/../CLAUDE.md`],
    ['別のファイル', (h: string) => join(h, '.claude', 'settings.json')]
  ])('%s → null', (_label, makePath) => {
    const locations = resolveGlobalAgentInstructionLocations({ env: {}, homeDir: home })
    expect(matchGlobalAgentInstructionPath(locations, makePath(home))).toBeNull()
  })

  it.each([null, 1, undefined, {}])('文字列でない値(%s) → null', (value) => {
    const locations = resolveGlobalAgentInstructionLocations({ env: {}, homeDir: home })
    expect(matchGlobalAgentInstructionPath(locations, value)).toBeNull()
  })

  it('unavailable の場所 → 一致しない', () => {
    const locations = resolveGlobalAgentInstructionLocations({
      env: { CLAUDE_CONFIG_DIR: 'rel' },
      homeDir: home
    })
    expect(
      matchGlobalAgentInstructionPath(locations, join(home, '.claude', 'CLAUDE.md'))
    ).toBeNull()
  })
})

describe('assertResolvedWithinHome', () => {
  it('ホームの中のファイル → 解決した先を返す', async () => {
    await writeFile(join(home, 'a.md'), 'x')
    await expect(assertResolvedWithinHome(home, join(home, 'a.md'))).resolves.toBe(
      join(home, 'a.md')
    )
  })

  it('ホームそのもの → 通す', async () => {
    await expect(assertResolvedWithinHome(home, home)).resolves.toBe(home)
  })

  itSymlink('ホームの中を指すリンク(dotfiles) → 通す', async () => {
    await mkdir(join(home, 'dotfiles'))
    await writeFile(join(home, 'dotfiles', 'CLAUDE.md'), 'x')
    await mkdir(join(home, '.claude'))
    await symlink(join(home, 'dotfiles', 'CLAUDE.md'), join(home, '.claude', 'CLAUDE.md'))
    await expect(assertResolvedWithinHome(home, join(home, '.claude', 'CLAUDE.md'))).resolves.toBe(
      join(home, 'dotfiles', 'CLAUDE.md')
    )
  })

  itSymlink('ホームの中を指すリンクのフォルダの下のファイル → 通す', async () => {
    await mkdir(join(home, 'dotfiles'))
    await writeFile(join(home, 'dotfiles', 'CLAUDE.md'), 'x')
    await symlink(join(home, 'dotfiles'), join(home, '.claude'))
    await expect(assertResolvedWithinHome(home, join(home, '.claude', 'CLAUDE.md'))).resolves.toBe(
      join(home, 'dotfiles', 'CLAUDE.md')
    )
  })

  itSymlink('ホームの外を指すファイルのリンク → 拒否(文言にパスが入らない)', async () => {
    await writeFile(join(outside, 'CLAUDE.md'), 'secret')
    await symlink(join(outside, 'CLAUDE.md'), join(home, 'CLAUDE.md'))
    const result = assertResolvedWithinHome(home, join(home, 'CLAUDE.md'))
    await expect(result).rejects.toBeInstanceOf(GlobalAgentInstructionAccessDeniedError)
    await expect(result).rejects.not.toThrow(root)
  })

  itSymlink('ホームと先頭の文字列が同じ隣のフォルダを指すリンク → 拒否', async () => {
    const sibling = join(root, 'home-evil')
    await mkdir(sibling)
    await writeFile(join(sibling, 'x.md'), 'secret')
    await symlink(join(sibling, 'x.md'), join(home, 'CLAUDE.md'))
    await expect(assertResolvedWithinHome(home, join(home, 'CLAUDE.md'))).rejects.toBeInstanceOf(
      GlobalAgentInstructionAccessDeniedError
    )
  })

  itSymlink('ホームの外を指すフォルダのリンク → 拒否', async () => {
    await symlink(outside, join(home, '.claude'))
    await expect(assertResolvedWithinHome(home, join(home, '.claude'))).rejects.toBeInstanceOf(
      GlobalAgentInstructionAccessDeniedError
    )
  })

  itSymlink('自分を指すリンク → realpath の失敗(ELOOP)をそのまま投げる', async () => {
    await symlink(join(home, 'loop.md'), join(home, 'loop.md'))
    await expect(assertResolvedWithinHome(home, join(home, 'loop.md'))).rejects.toMatchObject({
      code: 'ELOOP'
    })
  })

  itSymlink('ぶら下がったリンク → realpath の失敗(ENOENT)をそのまま投げる', async () => {
    await symlink(join(outside, 'missing.md'), join(home, 'CLAUDE.md'))
    await expect(assertResolvedWithinHome(home, join(home, 'CLAUDE.md'))).rejects.toMatchObject({
      code: 'ENOENT'
    })
  })
})
