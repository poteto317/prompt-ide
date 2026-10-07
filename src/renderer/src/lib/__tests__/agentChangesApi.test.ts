import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as agentChangesApi from '../agentChangesApi'

const mockApi = {
  beginAgentChanges: vi.fn(),
  getAgentChangesState: vi.fn(),
  listAgentChanges: vi.fn(),
  getAgentChangeDiff: vi.fn(),
  revertAgentChange: vi.fn(),
  revertAgentChangeHunk: vi.fn(),
  revertAllAgentChanges: vi.fn(),
  clearAgentChanges: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('agentChangesApi', () => {
  it('各関数は window.api の同名の関数へ引数をそのまま渡し、結果を返す', async () => {
    mockApi.beginAgentChanges.mockResolvedValue({ kind: 'recording', startedAt: 1 })
    mockApi.revertAllAgentChanges.mockResolvedValue({ status: 'done' })
    await expect(agentChangesApi.beginAgentChanges()).resolves.toEqual({
      kind: 'recording',
      startedAt: 1
    })
    await agentChangesApi.getAgentChangesState()
    await agentChangesApi.listAgentChanges()
    await agentChangesApi.getAgentChangeDiff('a.txt')
    await agentChangesApi.revertAgentChange('a.txt')
    await agentChangesApi.revertAgentChangeHunk('a.txt', 'patch')
    await expect(
      agentChangesApi.revertAllAgentChanges([{ path: 'a.txt', status: 'M' }])
    ).resolves.toEqual({ status: 'done' })
    await agentChangesApi.clearAgentChanges()
    expect(mockApi.getAgentChangesState).toHaveBeenCalledOnce()
    expect(mockApi.listAgentChanges).toHaveBeenCalledOnce()
    expect(mockApi.getAgentChangeDiff).toHaveBeenCalledWith('a.txt')
    expect(mockApi.revertAgentChange).toHaveBeenCalledWith('a.txt')
    expect(mockApi.revertAgentChangeHunk).toHaveBeenCalledWith('a.txt', 'patch')
    expect(mockApi.revertAllAgentChanges).toHaveBeenCalledWith([{ path: 'a.txt', status: 'M' }])
    expect(mockApi.clearAgentChanges).toHaveBeenCalledOnce()
  })
})
