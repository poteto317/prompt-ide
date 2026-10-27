import { describe, expect, it } from 'vitest'
import { interpretAgentHookRequest } from '../agentHookInterpretation'
import type { AgentHookBody } from '../agentHookEvents'
import type { AgentHookOwner } from '../agentHookReceiverRequest'

// 受け付けた要求の本文を経路ごとに知らせにする規則。claude は解釈だけで持ち主に触れず、copilot は振り分けの次の状態を持ち主に
// 書き戻す。経路と持ち主の種類の食い違いは例外(受け口が 200 にする)。解釈・振り分けの細かい規則は各モジュールのテスト

const MAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const json = (value: unknown): AgentHookBody => ({ kind: 'text', text: JSON.stringify(value) })

describe('interpretAgentHookRequest', () => {
  it('claude の経路は claude の解釈の結果をそのまま返し、持ち主を変えない', () => {
    const owner: AgentHookOwner = { ownerId: 1, sessionId: 's1', cli: { kind: 'claude' } }
    const result = interpretAgentHookRequest(
      { cliKind: 'claude', event: 'PreToolUse' },
      owner,
      json({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_use_id: 't1' })
    )
    expect(result).toEqual({
      event: {
        hookEventName: 'PreToolUse',
        toolName: 'Edit',
        kind: 'tool-start',
        toolId: { kind: 'read', id: 't1' },
        agentId: null
      },
      notes: []
    })
    expect(owner.cli).toEqual({ kind: 'claude' })
  })

  it('copilot の経路は振り分けた知らせを返し、主の会話の ID の次の状態を持ち主に書き戻す(SessionEnd で awaiting → 次のプロンプトで known)', () => {
    const owner: AgentHookOwner = {
      ownerId: 1,
      sessionId: 's1',
      cli: { kind: 'copilot', main: { kind: 'known', id: MAIN } }
    }
    const ended = interpretAgentHookRequest(
      { cliKind: 'copilot', event: 'SessionEnd' },
      owner,
      json({ hook_event_name: 'SessionEnd', session_id: MAIN })
    )
    expect(ended.event).toEqual({
      hookEventName: 'SessionEnd',
      toolName: null,
      kind: 'session-end'
    })
    expect(owner.cli).toEqual({ kind: 'copilot', main: { kind: 'awaiting' } })
    const prompted = interpretAgentHookRequest(
      { cliKind: 'copilot', event: 'UserPromptSubmit' },
      owner,
      json({ hook_event_name: 'UserPromptSubmit', session_id: NEW })
    )
    expect(prompted.event).toEqual({
      hookEventName: 'UserPromptSubmit',
      toolName: null,
      kind: 'confirm-only',
      reason: 'prompt-submit'
    })
    expect(owner.cli).toEqual({ kind: 'copilot', main: { kind: 'known', id: NEW } })
  })

  it('copilot の解釈の notes をそのまま返す', () => {
    const owner: AgentHookOwner = {
      ownerId: 1,
      sessionId: 's1',
      cli: { kind: 'copilot', main: { kind: 'known', id: MAIN } }
    }
    const result = interpretAgentHookRequest(
      { cliKind: 'copilot', event: 'PostToolUse' },
      owner,
      json({ hook_event_name: 'PostToolUse', session_id: MAIN, tool_name: 'view' })
    )
    expect(result.notes).toEqual(['unknown-tool-name'])
    expect(result.event).toMatchObject({ kind: 'confirm-only', reason: 'unknown-tool-end' })
  })

  it('copilot の経路に claude の持ち主が来たら例外にし、持ち主を変えない', () => {
    const owner: AgentHookOwner = { ownerId: 1, sessionId: 's1', cli: { kind: 'claude' } }
    expect(() =>
      interpretAgentHookRequest(
        { cliKind: 'copilot', event: 'Stop' },
        owner,
        json({ hook_event_name: 'Stop', session_id: MAIN })
      )
    ).toThrow('経路と持ち主の CLI の種類が違います')
    expect(owner.cli).toEqual({ kind: 'claude' })
  })
})
