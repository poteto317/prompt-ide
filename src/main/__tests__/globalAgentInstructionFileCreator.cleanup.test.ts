import { mkdir, mkdtemp, realpath, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'
import { resolveGlobalAgentInstructionLocations } from '../globalAgentInstructionLocations'
import { createGlobalAgentInstructionFile } from '../globalAgentInstructionFileCreator'

const mockCreateFileContent = vi.hoisted(() => vi.fn())
vi.mock('../fileSystem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../fileSystem')>()
  return { ...actual, createFileContent: mockCreateFileContent }
})

let root: string
let home: string

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'global-create-cleanup-')))
  home = join(root, 'home')
  await mkdir(home)
})

afterEach(async () => {
  vi.resetAllMocks()
  await removeTempPath(root)
})

describe('createGlobalAgentInstructionFile(後始末)', () => {
  it.skipIf(process.platform === 'win32')(
    '.claude が無い状態から始めてファイルの書き込みが失敗 → 作った .claude は 0o700 のフォルダとして残る(L-004)',
    async () => {
      mockCreateFileContent.mockRejectedValue(
        Object.assign(new Error('EACCES'), { code: 'EACCES' })
      )
      const location = resolveGlobalAgentInstructionLocations({ env: {}, homeDir: home }).claude
      if (location.kind !== 'resolved') throw new Error('unexpected unavailable')
      await expect(createGlobalAgentInstructionFile(location, home)).rejects.toMatchObject({
        code: 'EACCES'
      })
      const dir = await stat(join(home, '.claude'))
      expect(dir.isDirectory()).toBe(true)
      expect(dir.mode & 0o777).toBe(0o700)
      expect(mockCreateFileContent).toHaveBeenCalledTimes(1)
    }
  )
})
