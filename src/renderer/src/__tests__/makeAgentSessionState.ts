import { vi } from 'vitest'
import type { AgentSessionState } from '../hooks/useAgentSession'

// useAgentSession の戻り値の型付きの偽物(1 か所から作る。パターン 102)
export function makeAgentSessionState(
  overrides: Partial<AgentSessionState> = {}
): AgentSessionState {
  return {
    status: 'none',
    sessionId: null,
    exit: null,
    error: null,
    startDisabledReason: null,
    start: vi.fn<AgentSessionState['start']>(async () => undefined),
    stop: vi.fn<AgentSessionState['stop']>(async () => undefined),
    ...overrides
  }
}
