import { mkdtemp, readFile, readdir, writeFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AGENT_INSTRUCTION_FILES } from '@shared/agentInstructionFiles'
import { removeTempPath } from '@shared/__tests__/helpers/tempDirGuard'

// Windows では親がファイルのとき書き込みが ENOTDIR でなく ENOENT になる。それを模して、作成側の判定に頼れていることを確かめる
const { mockCreateFileContent } = vi.hoisted(() => ({ mockCreateFileContent: vi.fn() }))
vi.mock('../fileSystem', () => ({ createFileContent: mockCreateFileContent }))

import { createAgentInstructionFile } from '../agentInstructionFileCreator'

describe('createAgentInstructionFile: 親が通常のファイル', () => {
  let folder: string
  beforeEach(async () => {
    folder = await realpath(await mkdtemp(join(tmpdir(), 'aif-creator-')))
    mockCreateFileContent.mockReset()
    mockCreateFileContent.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
  })
  afterEach(async () => {
    await removeTempPath(folder)
  })

  it('.claude が同名のファイル → OS が ENOENT を返しても、stat で ENOTDIR を付けて拒否する', async () => {
    await writeFile(join(folder, '.claude'), 'file')
    const file = AGENT_INSTRUCTION_FILES.claude.find((f) => f.id === 'claude-dot')!
    const access = { assertParentWithinFolder: vi.fn(async (_r: string, p: string) => p) }
    await expect(createAgentInstructionFile(folder, access, file)).rejects.toMatchObject({
      code: 'ENOTDIR'
    })
    expect(mockCreateFileContent).not.toHaveBeenCalled()
    expect(await readFile(join(folder, '.claude'), 'utf-8')).toBe('file')
    expect(await readdir(folder)).toEqual(['.claude'])
  })
})
