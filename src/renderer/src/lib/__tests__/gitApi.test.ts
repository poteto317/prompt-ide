import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import {
  getGitStatus,
  stageFile,
  unstageFile,
  commitChanges,
  getDiff,
  stageHunk,
  unstageHunk,
  getLog,
  getBranches,
  getTags,
  amendCommit
} from '../gitApi'

const mockApi = {
  getGitStatus: vi.fn(),
  stageFile: vi.fn(),
  unstageFile: vi.fn(),
  commitChanges: vi.fn(),
  getDiff: vi.fn(),
  stageHunk: vi.fn(),
  unstageHunk: vi.fn(),
  getLog: vi.fn(),
  getBranches: vi.fn(),
  getTags: vi.fn(),
  amendCommit: vi.fn()
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
  files: []
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
    expect(mockApi.unstageFile).toHaveBeenCalledWith('src/index.ts', undefined)
  })

  it('renamedFrom を渡すと window.api.unstageFile の第2引数にそのまま渡す', async () => {
    mockApi.unstageFile.mockResolvedValue(undefined)
    await unstageFile('new.txt', 'old.txt')
    expect(mockApi.unstageFile).toHaveBeenCalledWith('new.txt', 'old.txt')
  })
})

describe('commitChanges', () => {
  it('window.api.commitChanges を message で呼び出す', async () => {
    mockApi.commitChanges.mockResolvedValue(undefined)
    await commitChanges('feat: 新機能')
    expect(mockApi.commitChanges).toHaveBeenCalledWith('feat: 新機能')
  })
})

describe('getDiff', () => {
  it('window.api.getDiff を filePath/staged/isUntracked で呼ぶ', async () => {
    ;(mockApi.getDiff as ReturnType<typeof vi.fn>).mockResolvedValue('DIFF')
    const result = await getDiff('src/index.ts', true, false)
    expect(mockApi.getDiff).toHaveBeenCalledWith('src/index.ts', true, false, undefined)
    expect(result).toBe('DIFF')
  })
})

describe('stageHunk', () => {
  it('window.api.stageHunk を filePath/patch で呼ぶ', async () => {
    await stageHunk('src/index.ts', 'PATCH')
    expect(mockApi.stageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH')
  })
})

describe('unstageHunk', () => {
  it('window.api.unstageHunk を filePath/patch で呼ぶ', async () => {
    await unstageHunk('src/index.ts', 'PATCH')
    expect(mockApi.unstageHunk).toHaveBeenCalledWith('src/index.ts', 'PATCH')
  })
})

describe('getLog', () => {
  it('window.api.getLog を limit/skip で呼ぶ', async () => {
    ;(mockApi.getLog as ReturnType<typeof vi.fn>).mockResolvedValue([])
    const result = await getLog(20, 0)
    expect(mockApi.getLog).toHaveBeenCalledWith(20, 0)
    expect(result).toEqual([])
  })
})

describe('getBranches', () => {
  it('window.api.getBranches を呼ぶ', async () => {
    ;(mockApi.getBranches as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await getBranches()
    expect(mockApi.getBranches).toHaveBeenCalled()
  })
})

describe('getTags', () => {
  it('window.api.getTags を呼ぶ', async () => {
    ;(mockApi.getTags as ReturnType<typeof vi.fn>).mockResolvedValue([])
    await getTags()
    expect(mockApi.getTags).toHaveBeenCalled()
  })
})

describe('amendCommit', () => {
  it('window.api.amendCommit を message で呼ぶ', async () => {
    await amendCommit('feat: 修正後')
    expect(mockApi.amendCommit).toHaveBeenCalledWith('feat: 修正後')
  })
})
