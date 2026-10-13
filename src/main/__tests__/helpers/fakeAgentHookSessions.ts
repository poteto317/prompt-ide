import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { AgentHookSessions, PreparedAgentHooks } from '../../agentHookSessions'

// starter・handler のテスト用の偽の hooks。呼ばれた順を calls に記録する。既定は hooks なし(今までどおりの引数)で起動する

export interface FakeAgentHookSessions {
  prepare: Mock<AgentHookSessions['prepare']>
  activate: Mock<AgentHookSessions['activate']>
  release: Mock<AgentHookSessions['release']>
  calls: string[]
}

export function preparedWithoutHooks(ownerId: number): PreparedAgentHooks {
  return { ownerId, hooks: null, unavailableReason: 'claude-version-unsupported' }
}

export function makeFakeAgentHookSessions(
  prepared: (ownerId: number) => PreparedAgentHooks = preparedWithoutHooks
): FakeAgentHookSessions {
  const calls: string[] = []
  return {
    calls,
    prepare: vi.fn<AgentHookSessions['prepare']>(async (ownerId) => {
      calls.push('prepare')
      return prepared(ownerId)
    }),
    activate: vi.fn<AgentHookSessions['activate']>((_prepared, sessionId) => {
      calls.push(`activate:${sessionId}`)
    }),
    release: vi.fn<AgentHookSessions['release']>((_prepared, sessionId) => {
      calls.push(`release:${sessionId ?? 'null'}`)
    })
  }
}
