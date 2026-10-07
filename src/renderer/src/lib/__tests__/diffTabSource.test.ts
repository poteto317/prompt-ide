import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchDiffForTab } from '../diffTabSource'
import * as gitApi from '../gitApi'
import * as agentChangesApi from '../agentChangesApi'

vi.mock('../gitApi', () => ({ getDiff: vi.fn() }))
vi.mock('../agentChangesApi', () => ({ getAgentChangeDiff: vi.fn() }))

describe('fetchDiffForTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(gitApi.getDiff).mockResolvedValue('git-diff')
    vi.mocked(agentChangesApi.getAgentChangeDiff).mockResolvedValue('agent-diff')
  })

  it('agent は記録との比較を取得し、git の diff も git status の情報も使わない', async () => {
    const result = await fetchDiffForTab(
      { path: 'a.ts', kind: 'agent' },
      { isUntracked: true, renamedFrom: 'old.ts' }
    )
    expect(result).toBe('agent-diff')
    expect(agentChangesApi.getAgentChangeDiff).toHaveBeenCalledWith('a.ts')
    expect(gitApi.getDiff).not.toHaveBeenCalled()
  })

  it('staged は staged=true で getDiff を呼び、リネーム元を渡す', async () => {
    const result = await fetchDiffForTab(
      { path: 'new.ts', kind: 'staged' },
      { isUntracked: false, renamedFrom: 'old.ts' }
    )
    expect(result).toBe('git-diff')
    expect(gitApi.getDiff).toHaveBeenCalledWith('new.ts', true, false, 'old.ts')
    expect(agentChangesApi.getAgentChangeDiff).not.toHaveBeenCalled()
  })

  it('unstaged は staged=false で未追跡の判定を渡す', async () => {
    await fetchDiffForTab(
      { path: 'u.ts', kind: 'unstaged' },
      { isUntracked: true, renamedFrom: undefined }
    )
    expect(gitApi.getDiff).toHaveBeenCalledWith('u.ts', false, true, undefined)
  })
})
