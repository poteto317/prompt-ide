import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { GitStatusResult } from '@shared/types'
import { getGitStatus } from '../gitApi'

const mockApi = {
  getGitStatus: vi.fn(),
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
