import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import { getGitStatus, stageFile, unstageFile, commitChanges } from '../gitApi'

const mockApi = {
  getGitStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  commitChanges: vi.fn(),
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

const mockResult: GitStatusResult = {
  isRepo: true,
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: [],
}

describe('getGitStatus', () => {
  it('window.api.getGitStatus を呼び出す', async () => {
    mockApi.getGitStatus.mockResolvedValue(mockResult)
    const result = await getGitStatus()
    expect(mockApi.getGitStatus).toHaveBeenCalledOnce()
    expect(result).toEqual(mockResult)
  })

  it('isRepo: false の結果もそのまま返す', async () => {
    const notRepo: GitStatusResult = { isRepo: false, branch: null, ahead: 0, behind: 0, files: [] }
    mockApi.getGitStatus.mockResolvedValue(notRepo)
    const result = await getGitStatus()
    expect(result).toEqual(notRepo)
  })
})

describe('stageFile', () => {
  it('window.api.stageFile を filePath で呼び出す', async () => {
    mockApi.stageFile.mockResolvedValue(undefined)
    await stageFile('src/index.ts')
    expect(mockApi.stageFile).toHaveBeenCalledWith('src/index.ts')
  })
})

describe('unstageFile', () => {
  it('window.api.unstageFile を filePath で呼び出す', async () => {
    mockApi.unstageFile.mockResolvedValue(undefined)
    await unstageFile('src/index.ts')
    expect(mockApi.unstageFile).toHaveBeenCalledWith('src/index.ts')
  })
})

describe('commitChanges', () => {
  it('window.api.commitChanges を message で呼び出す', async () => {
    mockApi.commitChanges.mockResolvedValue(undefined)
    await commitChanges('feat: 新機能')
    expect(mockApi.commitChanges).toHaveBeenCalledWith('feat: 新機能')
  })
})
