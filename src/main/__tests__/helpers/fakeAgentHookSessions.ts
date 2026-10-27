import { vi } from 'vitest'
import type { Mock } from 'vitest'
import type { AgentHookSessions, PreparedAgentHooks } from '../../agentHookSessions'
import type { AgentLaunchPlan } from '../../agentCommand'

// starter・handler のテスト用の偽の hooks。呼ばれた順を calls に記録する。既定は hooks なし(今までどおりの引数)で起動する

export interface FakeAgentHookSessions {
  prepare: Mock<AgentHookSessions['prepare']>
  activate: Mock<AgentHookSessions['activate']>
  release: Mock<AgentHookSessions['release']>
  calls: string[]
}

/** hooks なしの準備の結果(種類は起動の計画の種類) */
export function preparedWithoutHooks(ownerId: number, plan: AgentLaunchPlan): PreparedAgentHooks {
  return {
    ownerId,
    cliKind: plan.cliKind,
    hooks: null,
    unavailableReason: 'claude-version-unsupported'
  }
}

export function makeFakeAgentHookSessions(
  prepared: (ownerId: number, plan: AgentLaunchPlan) => PreparedAgentHooks = preparedWithoutHooks
): FakeAgentHookSessions {
  const calls: string[] = []
  return {
    calls,
    prepare: vi.fn<AgentHookSessions['prepare']>(async (ownerId, plan) => {
      calls.push('prepare')
      return prepared(ownerId, plan)
    }),
    activate: vi.fn<AgentHookSessions['activate']>((_prepared, sessionId) => {
      calls.push(`activate:${sessionId}`)
    }),
    release: vi.fn<AgentHookSessions['release']>((_prepared, sessionId) => {
      calls.push(`release:${sessionId ?? 'null'}`)
    })
  }
}
