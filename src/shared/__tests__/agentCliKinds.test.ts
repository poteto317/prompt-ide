import { describe, it, expect } from 'vitest'
import {
  AGENT_CLI_KINDS,
  AGENT_CLI_PROFILES,
  DEFAULT_AGENT_CLI_COMMAND_NAME,
  DEFAULT_AGENT_CLI_KIND,
  agentCliCapabilities,
  isAgentCliKind
} from '../agentCliKinds'
import type { AgentCliCapabilities } from '../agentCliKinds'

// 能力の項目(設計書「能力の項目」の 5 つ)。足したときは renderer の能力の名前の表(agentCliMessages.ts)も足す
const CAPABILITY_KEYS: readonly (keyof AgentCliCapabilities)[] = [
  'promptSend',
  'screenActivity',
  'interrupt',
  'changeAttribution',
  'sessionResume'
]

describe('isAgentCliKind', () => {
  it.each(['claude', 'copilot'])('%s は種類', (value) => {
    expect(isAgentCliKind(value)).toBe(true)
  })

  it.each(['Claude', '', 'codex', ' claude', 'gh copilot', 1, null, undefined, {}, ['claude']])(
    '%o は種類でない',
    (value) => {
      expect(isAgentCliKind(value)).toBe(false)
    }
  )
})

describe('AGENT_CLI_PROFILES', () => {
  it('既定は claude', () => {
    expect(DEFAULT_AGENT_CLI_KIND).toBe('claude')
  })

  it('既定のコマンド名は claude(既定の種類の表のコマンド名)', () => {
    expect(DEFAULT_AGENT_CLI_COMMAND_NAME).toBe('claude')
  })

  it('種類の一覧のすべてに表がある', () => {
    expect(Object.keys(AGENT_CLI_PROFILES).sort()).toEqual([...AGENT_CLI_KINDS].sort())
  })

  it('表示名とコマンド名', () => {
    expect(AGENT_CLI_PROFILES.claude).toMatchObject({
      displayName: 'Claude Code',
      commandName: 'claude'
    })
    expect(AGENT_CLI_PROFILES.copilot).toMatchObject({
      displayName: 'GitHub Copilot CLI',
      commandName: 'copilot'
    })
  })

  it('claude・copilot の能力はすべて真(段階 3a で sessionResume、段階 3b で changeAttribution も真にした)', () => {
    for (const kind of ['claude', 'copilot'] as const) {
      expect(agentCliCapabilities(kind)).toEqual({
        promptSend: true,
        screenActivity: true,
        interrupt: true,
        changeAttribution: true,
        sessionResume: true
      })
    }
  })

  it.each(AGENT_CLI_KINDS)('%s の能力の項目は 5 つ', (kind) => {
    expect(Object.keys(agentCliCapabilities(kind)).sort()).toEqual([...CAPABILITY_KEYS].sort())
  })

  // 中断を押せる条件は画面の判定の working なので、中断だけ真で判定が偽の種類は作れない
  it.each(AGENT_CLI_KINDS)('%s: interrupt が真なら screenActivity も真', (kind) => {
    const capabilities = agentCliCapabilities(kind)
    expect(!capabilities.interrupt || capabilities.screenActivity).toBe(true)
  })

  // 引数として解釈されない名前(L-034)。main はこの名前で PATH を探す
  it.each(AGENT_CLI_KINDS)('%s: commandName は - で始まらない英小文字だけ', (kind) => {
    expect(AGENT_CLI_PROFILES[kind].commandName).toMatch(/^[a-z]+$/)
  })
})
