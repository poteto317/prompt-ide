import { mkdir, mkdtemp, realpath, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { FolderAccessManager } from '../folderAccessManager'
import { resolveGlobalAgentInstructionContext } from '../globalAgentInstructionLocations'
import { GlobalAgentInstructionAccessDeniedError } from '../globalAgentInstructionAccess'
import { GLOBAL_INSTRUCTION_ACCESS_MESSAGES, resolveFileAccessScope } from '../fileAccessScope'
import type { FileAccessScopeDeps } from '../fileAccessScope'

const itPosix = it.skipIf(process.platform === 'win32')
let root: string
let home: string
let project: string
let deps: FileAccessScopeDeps
let globalFile: string

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
  root = await realpath(await mkdtemp(join(tmpdir(), 'file-access-scope-')))
  home = join(root, 'home')
  project = join(root, 'project')
  await mkdir(join(home, '.claude'), { recursive: true })
  await mkdir(project)
  globalFile = join(home, '.claude', 'CLAUDE.md')
  await writeFile(globalFile, 'x')
  await writeFile(join(project, 'a.md'), 'a')
  deps = {
    folderAccess: new FolderAccessManager(),
    globalInstructions: resolveGlobalAgentInstructionContext({ env: {}, homeDir: home })
  }
})

afterEach(async () => {
  vi.restoreAllMocks()
  await removeTempPath(root)
})

describe('resolveFileAccessScope', () => {
  it('全体の指示ファイル → フォルダを開いていなくても通る', async () => {
    await expect(
      resolveFileAccessScope(deps, 1, globalFile).assertExisting(globalFile)
    ).resolves.toBeUndefined()
  })

  it('全体の指示ファイルが消えた → assertRecreatable は親(~/.copilot)で通る', async () => {
    const missing = join(home, '.copilot', 'copilot-instructions.md')
    await mkdir(join(home, '.copilot'))
    await expect(
      resolveFileAccessScope(deps, 1, missing).assertRecreatable(missing)
    ).resolves.toBeUndefined()
  })

  it('全体の scope に作ったときと違うパス(ホームの中の別のファイル)を渡す → 2 つの検査とも拒否', async () => {
    const other = join(home, 'other.md')
    await writeFile(other, 'o')
    const scope = resolveFileAccessScope(deps, 1, globalFile)
    await expect(scope.assertExisting(other)).rejects.toBeInstanceOf(
      GlobalAgentInstructionAccessDeniedError
    )
    await expect(scope.assertRecreatable(other)).rejects.toBeInstanceOf(
      GlobalAgentInstructionAccessDeniedError
    )
  })

  it('ほかのパス → 許可フォルダの規則(フォルダの中は通る・外は断る)', async () => {
    deps.folderAccess.set(1, project)
    const inside = join(project, 'a.md')
    await expect(
      resolveFileAccessScope(deps, 1, inside).assertExisting(inside)
    ).resolves.toBeUndefined()
    const other = join(home, 'other.md')
    await writeFile(other, 'o')
    await expect(resolveFileAccessScope(deps, 1, other).assertExisting(other)).rejects.toThrow(
      'Access denied'
    )
  })

  it('ほかのパスでフォルダが無い → No folder open', async () => {
    const inside = join(project, 'a.md')
    await expect(resolveFileAccessScope(deps, 1, inside).assertExisting(inside)).rejects.toThrow(
      'No folder open'
    )
  })

  it('許可フォルダの scope → 作った時点のフォルダで 2 つの検査をする(後の切り替えに追従しない)', async () => {
    deps.folderAccess.set(1, project)
    const inside = join(project, 'a.md')
    const scope = resolveFileAccessScope(deps, 1, inside)
    deps.folderAccess.set(1, home)
    await expect(scope.assertExisting(inside)).resolves.toBeUndefined()
    await expect(scope.assertRecreatable(inside)).resolves.toBeUndefined()
  })

  itPosix('全体の指示ファイルがホームの外へのリンク → 拒否', async () => {
    const outside = join(root, 'outside.md')
    await writeFile(outside, 's')
    const copilotFile = join(home, '.copilot', 'copilot-instructions.md')
    await mkdir(join(home, '.copilot'))
    await symlink(outside, copilotFile)
    await expect(
      resolveFileAccessScope(deps, 1, copilotFile).assertExisting(copilotFile)
    ).rejects.toBeInstanceOf(GlobalAgentInstructionAccessDeniedError)
  })

  // ~/.claude がホームの外へのリンクで、利用者が ~/.claude そのものを許可フォルダとして開いた場合(ツリーのパスは字面のまま)。
  // 変更前は許可フォルダの中として読み書きできたので、全体の規則で断られても許可フォルダの規則で確かめる
  itPosix(
    '全体のパスと一致しホームの外へのリンクだが、許可フォルダの中 → 2 つの検査とも通る',
    async () => {
      const outsideDir = join(root, 'dotfiles-claude')
      await mkdir(outsideDir)
      await writeFile(join(outsideDir, 'CLAUDE.md'), 'd')
      await removeTempPath(join(home, '.claude'))
      await symlink(outsideDir, join(home, '.claude'))
      deps.folderAccess.set(1, await realpath(join(home, '.claude')))
      const scope = resolveFileAccessScope(deps, 1, globalFile)
      await expect(scope.assertExisting(globalFile)).resolves.toBeUndefined()
      await expect(scope.assertRecreatable(globalFile)).resolves.toBeUndefined()
    }
  )

  itPosix(
    '全体のパスと一致しホームの外へのリンクで、ファイルが消えた・許可フォルダの中 → assertRecreatable は通る',
    async () => {
      const outsideDir = join(root, 'dotfiles-claude')
      await mkdir(outsideDir)
      await removeTempPath(join(home, '.claude'))
      await symlink(outsideDir, join(home, '.claude'))
      // 許可フォルダはダイアログの後と同じく realpath した値で持つ
      deps.folderAccess.set(1, await realpath(join(home, '.claude')))
      await expect(
        resolveFileAccessScope(deps, 1, globalFile).assertRecreatable(globalFile)
      ).resolves.toBeUndefined()
    }
  )

  itPosix(
    '全体のパスと一致しホームの外へのリンクで、許可フォルダの外 → 全体の拒否のまま',
    async () => {
      const outsideDir = join(root, 'dotfiles-claude')
      await mkdir(outsideDir)
      await writeFile(join(outsideDir, 'CLAUDE.md'), 'd')
      await removeTempPath(join(home, '.claude'))
      await symlink(outsideDir, join(home, '.claude'))
      deps.folderAccess.set(1, project)
      const scope = resolveFileAccessScope(deps, 1, globalFile)
      await expect(scope.assertExisting(globalFile)).rejects.toBeInstanceOf(
        GlobalAgentInstructionAccessDeniedError
      )
      await expect(scope.assertRecreatable(globalFile)).rejects.toBeInstanceOf(
        GlobalAgentInstructionAccessDeniedError
      )
    }
  )

  itPosix(
    '全体のパスの許可フォルダの規則も、作った時点のフォルダで確かめる(後の切り替えに追従しない)',
    async () => {
      const outsideDir = join(root, 'dotfiles-claude')
      await mkdir(outsideDir)
      await writeFile(join(outsideDir, 'CLAUDE.md'), 'd')
      await removeTempPath(join(home, '.claude'))
      await symlink(outsideDir, join(home, '.claude'))
      deps.folderAccess.set(1, project)
      const scope = resolveFileAccessScope(deps, 1, globalFile)
      deps.folderAccess.set(1, await realpath(join(home, '.claude')))
      await expect(scope.assertExisting(globalFile)).rejects.toBeInstanceOf(
        GlobalAgentInstructionAccessDeniedError
      )
      await expect(scope.assertRecreatable(globalFile)).rejects.toBeInstanceOf(
        GlobalAgentInstructionAccessDeniedError
      )
    }
  )

  it.each([
    [
      '拒否',
      new GlobalAgentInstructionAccessDeniedError(),
      'read',
      GLOBAL_INSTRUCTION_ACCESS_MESSAGES.denied
    ],
    [
      '拒否(保存)',
      new GlobalAgentInstructionAccessDeniedError(),
      'write',
      GLOBAL_INSTRUCTION_ACCESS_MESSAGES.deniedWrite
    ],
    [
      'ENOENT',
      Object.assign(new Error(`ENOENT: ${'/secret/path'}`), { code: 'ENOENT' }),
      'read',
      GLOBAL_INSTRUCTION_ACCESS_MESSAGES.missing
    ],
    [
      'EACCES の読み込み',
      Object.assign(new Error('EACCES: /secret/path'), { code: 'EACCES' }),
      'read',
      GLOBAL_INSTRUCTION_ACCESS_MESSAGES.read
    ],
    [
      'EACCES の保存',
      Object.assign(new Error('EACCES: /secret/path'), { code: 'EACCES' }),
      'write',
      GLOBAL_INSTRUCTION_ACCESS_MESSAGES.write
    ]
  ] as const)(
    '全体の指示ファイルの失敗(%s) → パスを含まない固定の文言',
    (_label, err, operation, message) => {
      const converted = resolveFileAccessScope(deps, 1, globalFile).toRendererError(err, operation)
      expect(converted).toBeInstanceOf(Error)
      expect((converted as Error).message).toBe(message)
      expect((converted as Error).message).not.toContain('/')
    }
  )

  it('保存で断ったときの文言は「保存できません」で、読む側の文言と違う', () => {
    const converted = resolveFileAccessScope(deps, 1, globalFile).toRendererError(
      new GlobalAgentInstructionAccessDeniedError(),
      'write'
    )
    expect((converted as Error).message).toContain('保存できません')
    expect((converted as Error).message).not.toBe(GLOBAL_INSTRUCTION_ACCESS_MESSAGES.denied)
  })

  it('フォルダのファイルの失敗 → 今と同じ文言(パスを含む)', () => {
    deps.folderAccess.set(1, project)
    const inside = join(project, 'a.md')
    const converted = resolveFileAccessScope(deps, 1, inside).toRendererError(
      Object.assign(new Error('ENOENT'), { code: 'ENOENT' }),
      'read'
    )
    expect((converted as Error).message).toBe(`ファイルが見つかりません: ${inside}`)
  })
})
