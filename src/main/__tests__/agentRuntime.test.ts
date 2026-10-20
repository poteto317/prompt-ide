import { describe, it, expect, vi, beforeEach } from 'vitest'

// agentRuntime は実物の依存(node-pty)を組み立てる。ここでは設定の読み込みと解決への受け渡しだけを確かめる
vi.mock('node-pty', () => ({ spawn: vi.fn() }))
const mockGetAgentCliKindSetting = vi.hoisted(() => vi.fn())
vi.mock('../agentCliKindStore', () => ({ getAgentCliKindSetting: mockGetAgentCliKindSetting }))
const mockResolveAgentLaunch = vi.hoisted(() => vi.fn())
vi.mock('../agentCommand', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../agentCommand')>()),
  resolveAgentLaunch: mockResolveAgentLaunch
}))

import { resolveAgentLaunchFromSystem } from '../agentRuntime'

beforeEach(() => {
  vi.clearAllMocks()
  mockResolveAgentLaunch.mockResolvedValue({
    kind: 'not-found',
    cliKind: 'claude',
    shellPathUnavailable: false
  })
})

describe('resolveAgentLaunchFromSystem', () => {
  it('起動のたびに設定を読み、読んだ種類で解決する(保存した値は次の起動から使われる)', async () => {
    mockGetAgentCliKindSetting
      .mockResolvedValueOnce({ kind: 'copilot', fallback: null })
      .mockResolvedValueOnce({ kind: 'claude', fallback: 'invalid-value' })
    await resolveAgentLaunchFromSystem()
    await resolveAgentLaunchFromSystem()
    expect(mockGetAgentCliKindSetting).toHaveBeenCalledTimes(2)
    expect(mockResolveAgentLaunch.mock.calls.map(([deps]) => deps.cliKind)).toEqual([
      'copilot',
      'claude'
    ])
  })
})
