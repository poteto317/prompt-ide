import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as agentTerminalApi from '../agentTerminalApi'

const mockApi = {
  startAgentSession: vi.fn(),
  writeAgentSession: vi.fn(),
  resizeAgentSession: vi.fn(),
  stopAgentSession: vi.fn(),
  interruptAgentSession: vi.fn(),
  interruptAgentSessionFollowUp: vi.fn(),
  getAgentSessions: vi.fn(),
  getLastAgentSession: vi.fn(),
  onAgentData: vi.fn(),
  onAgentExit: vi.fn(),
  setAgentTerminalFocused: vi.fn(),
  reportAgentSessionWorking: vi.fn(),
  reportAgentSessionWorkingEnded: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('agentTerminalApi', () => {
  it('各関数は window.api の同名の関数へ引数をそのまま渡す', () => {
    agentTerminalApi.startAgentSession({
      slotId: 'slot-1',
      folderPath: '/p',
      cols: 80,
      rows: 24,
      launch: { kind: 'new' }
    })
    agentTerminalApi.writeAgentSession('s', 'x')
    agentTerminalApi.resizeAgentSession('s', 100, 30)
    agentTerminalApi.stopAgentSession('s')
    agentTerminalApi.interruptAgentSession('s')
    agentTerminalApi.interruptAgentSessionFollowUp('s')
    agentTerminalApi.getAgentSessions()
    agentTerminalApi.getLastAgentSession('/p')
    agentTerminalApi.setAgentTerminalFocused(true)
    agentTerminalApi.reportAgentSessionWorking('s')
    agentTerminalApi.reportAgentSessionWorkingEnded('s')
    expect(mockApi.startAgentSession).toHaveBeenCalledWith({
      slotId: 'slot-1',
      folderPath: '/p',
      cols: 80,
      rows: 24,
      launch: { kind: 'new' }
    })
    expect(mockApi.writeAgentSession).toHaveBeenCalledWith('s', 'x')
    expect(mockApi.resizeAgentSession).toHaveBeenCalledWith('s', 100, 30)
    expect(mockApi.stopAgentSession).toHaveBeenCalledWith('s')
    expect(mockApi.interruptAgentSession).toHaveBeenCalledWith('s')
    expect(mockApi.interruptAgentSessionFollowUp).toHaveBeenCalledWith('s')
    expect(mockApi.getAgentSessions).toHaveBeenCalledOnce()
    expect(mockApi.getLastAgentSession).toHaveBeenCalledWith('/p')
    expect(mockApi.setAgentTerminalFocused).toHaveBeenCalledWith(true)
    expect(mockApi.reportAgentSessionWorking).toHaveBeenCalledWith('s')
    expect(mockApi.reportAgentSessionWorkingEnded).toHaveBeenCalledWith('s')
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
