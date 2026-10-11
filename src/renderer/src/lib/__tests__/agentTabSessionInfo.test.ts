import { describe, it, expect } from 'vitest'
import { describeAgentTabSession } from '../agentTabSessionInfo'
import type { AgentTabSessionSource } from '../agentTabSessionInfo'

const ID_A = '11111111-1111-4111-8111-111111111111'
const ID_B = '22222222-2222-4222-9222-222222222222'

const tab = (overrides: Partial<AgentTabSessionSource>): AgentTabSessionSource => ({
  slotId: 'tab-1',
  label: 'claude',
  status: 'running',
  claudeSessionId: ID_A,
  ...overrides
})

describe('describeAgentTabSession', () => {
  it('slotId のタブの ID・名前と開いているフォルダを返す', () => {
    const tabs = [tab({}), tab({ slotId: 'tab-2', label: 'claude 2', claudeSessionId: ID_B })]
    expect(describeAgentTabSession(tabs, 'tab-2', '/work')).toEqual({
      claudeSessionId: ID_B,
      tabLabel: 'claude 2',
      folderPath: '/work'
    })
  })

  it('タブが無い・ID が無い・フォルダを開いていなければ null', () => {
    expect(describeAgentTabSession([tab({})], 'missing', '/work')).toBeNull()
    expect(describeAgentTabSession([tab({ claudeSessionId: null })], 'tab-1', '/work')).toBeNull()
    expect(describeAgentTabSession([tab({})], 'tab-1', null)).toBeNull()
  })
})
