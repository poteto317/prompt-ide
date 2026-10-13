import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as agentChangesApi from '../agentChangesApi'
import {
  makeAgentChangesRecordingState,
  makeAgentRevertAllResult
} from '../../__tests__/makeAgentChangesState'

const mockApi = {
  beginAgentChanges: vi.fn(),
  getAgentChangesState: vi.fn(),
  listAgentChanges: vi.fn(),
  getAgentChangeDiff: vi.fn(),
  revertAgentChange: vi.fn(),
  revertAgentChangeHunk: vi.fn(),
  revertAllAgentChanges: vi.fn(),
  undoAgentChangesRevert: vi.fn(),
  clearAgentChanges: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('agentChangesApi', () => {
  it('各関数は window.api の同名の関数へ引数をそのまま渡し、結果を返す', async () => {
    mockApi.beginAgentChanges.mockResolvedValue(makeAgentChangesRecordingState({ startedAt: 1 }))
    mockApi.revertAllAgentChanges.mockResolvedValue(makeAgentRevertAllResult())
    await expect(agentChangesApi.beginAgentChanges('send')).resolves.toEqual({
      kind: 'recording',
      startedAt: 1,
      runs: [],
      undo: null
    })
    await agentChangesApi.getAgentChangesState()
    await agentChangesApi.listAgentChanges({ kind: 'all' })
    await agentChangesApi.getAgentChangeDiff('a.txt', { kind: 'all' })
    await agentChangesApi.revertAgentChange('a.txt', { kind: 'all' })
    await agentChangesApi.revertAgentChangeHunk('a.txt', 'patch', { kind: 'all' })
    await expect(
      agentChangesApi.revertAllAgentChanges([{ path: 'a.txt', status: 'M' }], { kind: 'all' })
    ).resolves.toEqual(makeAgentRevertAllResult())
    await agentChangesApi.undoAgentChangesRevert(4)
    await agentChangesApi.clearAgentChanges()
    expect(mockApi.beginAgentChanges).toHaveBeenCalledWith('send')
    expect(mockApi.getAgentChangesState).toHaveBeenCalledOnce()
    expect(mockApi.listAgentChanges).toHaveBeenCalledWith({ kind: 'all' })
    expect(mockApi.getAgentChangeDiff).toHaveBeenCalledWith('a.txt', { kind: 'all' })
    expect(mockApi.revertAgentChange).toHaveBeenCalledWith('a.txt', { kind: 'all' })
    expect(mockApi.revertAgentChangeHunk).toHaveBeenCalledWith('a.txt', 'patch', { kind: 'all' })
    expect(mockApi.revertAllAgentChanges).toHaveBeenCalledWith([{ path: 'a.txt', status: 'M' }], {
      kind: 'all'
    })
    expect(mockApi.undoAgentChangesRevert).toHaveBeenCalledWith(4)
    expect(mockApi.clearAgentChanges).toHaveBeenCalledOnce()
  })
})
