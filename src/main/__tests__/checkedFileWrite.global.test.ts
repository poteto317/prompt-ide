import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rmdir,
  realpath,
  symlink,
  writeFile
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { FolderAccessManager } from '../folderAccessManager'
import { resolveGlobalAgentInstructionContext } from '../globalAgentInstructionLocations'
import { resolveFileAccessScope } from '../fileAccessScope'
import { GlobalAgentInstructionAccessDeniedError } from '../globalAgentInstructionAccess'
import { writeFileChecked } from '../checkedFileWrite'

const describePosix = describe.skipIf(process.platform === 'win32')
let root: string
let home: string
let globalFile: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'checked-write-global-')))
  home = join(root, 'home')
  await mkdir(join(home, '.claude'), { recursive: true })
  globalFile = join(home, '.claude', 'CLAUDE.md')
})

afterEach(async () => {
  await removeTempPath(root)
})

const scopeFor = (path: string): ReturnType<typeof resolveFileAccessScope> =>
  resolveFileAccessScope(
    {
      folderAccess: new FolderAccessManager(),
      globalInstructions: resolveGlobalAgentInstructionContext({ env: {}, homeDir: home })
    },
    1,
    path
  )

describePosix('writeFileChecked(全体の指示ファイル)', () => {
  it('ホームの中のリンク → リンク先を書き換え、リンクは残る', async () => {
    await writeFile(join(home, 'real.md'), 'old')
    await symlink(join(home, 'real.md'), globalFile)
    await expect(
      writeFileChecked({
        scope: scopeFor(globalFile),
        filePath: globalFile,
        content: 'new',
        baseContent: 'old'
      })
    ).resolves.toEqual({ kind: 'written' })
    expect(await readFile(join(home, 'real.md'), 'utf-8')).toBe('new')
    expect((await lstat(globalFile)).isSymbolicLink()).toBe(true)
    expect(await readlink(globalFile)).toBe(join(home, 'real.md'))
  })

  it('消えたファイル → wx で作り直す', async () => {
    await expect(
      writeFileChecked({
        scope: scopeFor(globalFile),
        filePath: globalFile,
        content: 'new',
        baseContent: null
      })
    ).resolves.toEqual({ kind: 'written' })
    expect(await readFile(globalFile, 'utf-8')).toBe('new')
  })

  it('ホームの外を指すぶら下がったリンク → 辿らずに modified', async () => {
    const outside = join(root, 'outside.md')
    await symlink(outside, globalFile)
    await expect(
      writeFileChecked({
        scope: scopeFor(globalFile),
        filePath: globalFile,
        content: 'new',
        baseContent: null
      })
    ).resolves.toEqual({ kind: 'conflict', reason: 'modified' })
    await expect(lstat(outside)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('親の ~/.claude がホームの外へのリンクで先に CLAUDE.md が無い → 作り直さず拒否', async () => {
    const outside = join(root, 'outside')
    await mkdir(outside)
    await rmdir(join(home, '.claude'))
    await symlink(outside, join(home, '.claude'))
    await expect(
      writeFileChecked({
        scope: scopeFor(globalFile),
        filePath: globalFile,
        content: 'x',
        baseContent: null
      })
    ).rejects.toBeInstanceOf(GlobalAgentInstructionAccessDeniedError)
    expect(await readdir(outside)).toEqual([])
  })
})
