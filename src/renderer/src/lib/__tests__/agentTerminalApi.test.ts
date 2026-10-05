import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as agentTerminalApi from '../agentTerminalApi'

const mockApi = {
  startAgentSession: vi.fn(),
  writeAgentSession: vi.fn(),
  resizeAgentSession: vi.fn(),
  stopAgentSession: vi.fn(),
  getAgentSession: vi.fn(),
  onAgentData: vi.fn(),
  onAgentExit: vi.fn(),
  setAgentTerminalFocused: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('agentTerminalApi', () => {
  it('各関数は window.api の同名の関数へ引数をそのまま渡す', () => {
    agentTerminalApi.startAgentSession({ folderPath: '/p', cols: 80, rows: 24 })
    agentTerminalApi.writeAgentSession('s', 'x')
    agentTerminalApi.resizeAgentSession('s', 100, 30)
    agentTerminalApi.stopAgentSession('s')
    agentTerminalApi.getAgentSession()
    agentTerminalApi.setAgentTerminalFocused(true)
    expect(mockApi.startAgentSession).toHaveBeenCalledWith({ folderPath: '/p', cols: 80, rows: 24 })
    expect(mockApi.writeAgentSession).toHaveBeenCalledWith('s', 'x')
    expect(mockApi.resizeAgentSession).toHaveBeenCalledWith('s', 100, 30)
    expect(mockApi.stopAgentSession).toHaveBeenCalledWith('s')
    expect(mockApi.getAgentSession).toHaveBeenCalledOnce()
    expect(mockApi.setAgentTerminalFocused).toHaveBeenCalledWith(true)
  })

  it('購読は解除関数を返す', () => {
    const offData = vi.fn()
    const offExit = vi.fn()
    mockApi.onAgentData.mockReturnValue(offData)
    mockApi.onAgentExit.mockReturnValue(offExit)
    expect(agentTerminalApi.onAgentData(vi.fn())).toBe(offData)
    expect(agentTerminalApi.onAgentExit(vi.fn())).toBe(offExit)
  })
})
