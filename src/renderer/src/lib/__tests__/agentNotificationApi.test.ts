import { describe, it, expect, vi, beforeEach } from 'vitest'
import * as agentNotificationApi from '../agentNotificationApi'

const mockApi = {
  showAgentNotification: vi.fn(),
  setAgentNotificationBadge: vi.fn(),
  dismissAgentNotification: vi.fn(),
  onAgentNotificationActivated: vi.fn()
}

beforeEach(() => {
  vi.stubGlobal('api', mockApi)
  vi.clearAllMocks()
})

describe('agentNotificationApi', () => {
  it('各関数は window.api の同名の関数へ引数をそのまま渡す', () => {
    const unsubscribe = vi.fn()
    mockApi.onAgentNotificationActivated.mockReturnValue(unsubscribe)
    const listener = vi.fn()
    agentNotificationApi.showAgentNotification({
      slotId: 's-1',
      tabNumber: 1,
      kind: 'done',
      cliKind: 'claude'
    })
    agentNotificationApi.setAgentNotificationBadge(2)
    agentNotificationApi.dismissAgentNotification({ slotId: 's-2' })
    expect(agentNotificationApi.onAgentNotificationActivated(listener)).toBe(unsubscribe)
    expect(mockApi.showAgentNotification).toHaveBeenCalledWith({
      slotId: 's-1',
      tabNumber: 1,
      kind: 'done',
      cliKind: 'claude'
    })
    expect(mockApi.setAgentNotificationBadge).toHaveBeenCalledWith(2)
    expect(mockApi.dismissAgentNotification).toHaveBeenCalledWith({ slotId: 's-2' })
    expect(mockApi.onAgentNotificationActivated).toHaveBeenCalledWith(listener)
  })
})
