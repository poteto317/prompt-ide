import { describe, expect, it } from 'vitest'
import { parseAgentHookRequest } from '../agentHookEvents'
import type { AgentHookBody, AgentHookParseResult } from '../agentHookEvents'
import type { AgentHookEventName } from '../agentHookProtocol'

const json = (value: unknown): AgentHookBody => ({ kind: 'text', text: JSON.stringify(value) })
const parse = (event: AgentHookEventName, value: unknown): AgentHookParseResult =>
  parseAgentHookRequest(event, json(value))

describe('parseAgentHookRequest(ツール以外のイベント)', () => {
  it.each<[AgentHookEventName, unknown]>([
    [
      'UserPromptSubmit',
      {
        kind: 'confirm-only',
        reason: 'prompt-submit',
        hookEventName: 'UserPromptSubmit',
        toolName: null
      }
    ],
    ['Stop', { kind: 'turn-end', hookEventName: 'Stop', toolName: null }],
    ['StopFailure', { kind: 'turn-end', hookEventName: 'StopFailure', toolName: null }],
    ['SessionEnd', { kind: 'session-end', hookEventName: 'SessionEnd', toolName: null }]
  ])('%s', (event, expected) => {
    expect(parse(event, { hook_event_name: event, session_id: 's', prompt: 'x' })).toEqual({
      event: expected,
      notes: []
    })
  })

  it('SubagentStop は agent_id があれば subagent-stop', () => {
    expect(
      parse('SubagentStop', { hook_event_name: 'SubagentStop', agent_id: 'ag-1' }).event
    ).toEqual({
      kind: 'subagent-stop',
      agentId: 'ag-1',
      hookEventName: 'SubagentStop',
      toolName: null
    })
  })

  it('SubagentStop は agent_id が無ければ confirm-only(subagent-stop-without-agent。notes は無い)', () => {
    expect(parse('SubagentStop', { hook_event_name: 'SubagentStop' })).toEqual({
      event: {
        kind: 'confirm-only',
        reason: 'subagent-stop-without-agent',
        hookEventName: 'SubagentStop',
        toolName: null
      },
      notes: []
    })
  })

  it('SubagentStop は agent_id の形が違えば confirm-only(notes に bad-agent-id)', () => {
    expect(parse('SubagentStop', { hook_event_name: 'SubagentStop', agent_id: 3 })).toEqual({
      event: {
        kind: 'confirm-only',
        reason: 'bad-agent-id',
        hookEventName: 'SubagentStop',
        toolName: null
      },
      notes: ['bad-agent-id']
    })
  })
})

describe('parseAgentHookRequest(ツールのイベント)', () => {
  const pre = (extra: Record<string, unknown>): AgentHookParseResult =>
    parse('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_use_id: 'toolu_1',
      ...extra
    })
  const post = (
    extra: Record<string, unknown>,
    event: 'PostToolUse' | 'PostToolUseFailure' = 'PostToolUse'
  ): AgentHookParseResult =>
    parse(event, { hook_event_name: event, tool_name: 'Edit', tool_use_id: 'toolu_1', ...extra })

  it('PreToolUse は tool-start、PostToolUse・PostToolUseFailure は tool-end(hookEventName で見分けられる)', () => {
    expect(pre({}).event).toEqual({
      kind: 'tool-start',
      hookEventName: 'PreToolUse',
      toolName: 'Edit',
      toolId: { kind: 'read', id: 'toolu_1' },
      agentId: null
    })
    expect(post({ agent_id: 'ag-1' }, 'PostToolUseFailure').event).toEqual({
      kind: 'tool-end',
      hookEventName: 'PostToolUseFailure',
      toolName: 'Edit',
      toolId: { kind: 'read', id: 'toolu_1' },
      agentId: 'ag-1'
    })
  })

  it.each<[string, unknown, string | null]>([
    ['matcher の名前', 'Bash', 'Bash'],
    ['matcher に無い形の合う名前', 'mcp__x_y-z', 'mcp__x_y-z'],
    ['64 文字', 'a'.repeat(64), 'a'.repeat(64)],
    ['65 文字', 'a'.repeat(65), null],
    ['記号を含む', 'Ed it', null],
    ['数値', 3, null],
    ['無い', undefined, null]
  ])('toolName: %s', (_label, toolName, expected) => {
    expect(pre({ tool_name: toolName }).event.toolName).toBe(expected)
  })

  it('知らない tool_name の PreToolUse は区間を開き(L-002)、PostToolUse・PostToolUseFailure は捨てる(L-044)', () => {
    expect(pre({ tool_name: 'Foo' })).toEqual({
      event: {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: 'Foo',
        toolId: { kind: 'read', id: 'toolu_1' },
        agentId: null
      },
      notes: ['unknown-tool-name']
    })
    expect(post({ tool_name: 'Foo' }, 'PostToolUseFailure')).toEqual({
      event: {
        kind: 'confirm-only',
        reason: 'unknown-tool-end',
        hookEventName: 'PostToolUseFailure',
        toolName: 'Foo'
      },
      notes: ['unknown-tool-name']
    })
  })

  it.each<[string, unknown]>([
    ['空', ''],
    ['257 文字', 'x'.repeat(257)],
    ['数値', 1],
    ['無い', undefined]
  ])('tool_use_id が %s なら ID なし', (_label, toolUseId) => {
    expect(pre({ tool_use_id: toolUseId }).event).toMatchObject({ toolId: { kind: 'unreadable' } })
    expect(post({ tool_use_id: toolUseId }).event).toMatchObject({
      kind: 'tool-end',
      toolId: { kind: 'unreadable' }
    })
  })

  it('tool_use_id は 256 文字まで読む', () => {
    expect(pre({ tool_use_id: 'x'.repeat(256) }).event).toMatchObject({
      toolId: { kind: 'read', id: 'x'.repeat(256) }
    })
  })

  it.each<[string, unknown]>([
    ['空', ''],
    ['257 文字', 'a'.repeat(257)],
    ['数値', 1],
    ['null', null]
  ])(
    'agent_id が %s(形が違う)なら、PreToolUse は ID なしの区間、PostToolUse は捨てる',
    (_label, agentId) => {
      expect(pre({ agent_id: agentId })).toEqual({
        event: {
          kind: 'tool-start',
          hookEventName: 'PreToolUse',
          toolName: 'Edit',
          toolId: { kind: 'unreadable' },
          agentId: null
        },
        notes: ['bad-agent-id']
      })
      expect(post({ agent_id: agentId })).toEqual({
        event: {
          kind: 'confirm-only',
          reason: 'bad-agent-id',
          hookEventName: 'PostToolUse',
          toolName: 'Edit'
        },
        notes: ['bad-agent-id']
      })
    }
  )
})

describe('parseAgentHookRequest(読めない本文)', () => {
  it.each<[string, AgentHookBody, string[]]>([
    ['16 MiB を超えた', { kind: 'too-large' }, []],
    ['読み込みの失敗', { kind: 'unreadable' }, ['unreadable-body']],
    ['JSON でない', { kind: 'text', text: '{' }, ['unreadable-body']],
    ['オブジェクトでない', { kind: 'text', text: '[1]' }, ['unreadable-body']],
    [
      'イベント名がパスと違う(L-023)',
      json({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_use_id: 'toolu_1' }),
      ['event-name-mismatch']
    ]
  ])('%s ときは、パスのイベントだけで扱う(ツールのイベントは ID なし)', (_label, body, notes) => {
    expect(parseAgentHookRequest('PreToolUse', body)).toEqual({
      event: {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: null,
        toolId: { kind: 'unreadable' },
        agentId: null
      },
      notes
    })
    expect(parseAgentHookRequest('UserPromptSubmit', body).event.kind).toBe('confirm-only')
    expect(parseAgentHookRequest('SubagentStop', body).event).toMatchObject({
      kind: 'confirm-only',
      reason: 'subagent-stop-without-agent'
    })
    expect(parseAgentHookRequest('Stop', body).event.kind).toBe('turn-end')
    expect(parseAgentHookRequest('SessionEnd', body).event.kind).toBe('session-end')
    expect(parseAgentHookRequest('PostToolBatch', body).event).toMatchObject({
      kind: 'confirm-only',
      reason: 'batch-end-unreadable'
    })
  })

  it('PostToolUse の本文を読めなければ、ID なしの tool-end(何も閉じない側)にする', () => {
    for (const body of [
      { kind: 'too-large' },
      { kind: 'unreadable' },
      { kind: 'text', text: '{' }
    ] as AgentHookBody[]) {
      expect(parseAgentHookRequest('PostToolUse', body).event).toEqual({
        kind: 'tool-end',
        hookEventName: 'PostToolUse',
        toolName: null,
        toolId: { kind: 'unreadable' },
        agentId: null
      })
    }
  })

  it('余分な欄(tool_input・cwd・transcript_path)は読まない', () => {
    const withExtras = parse('PreToolUse', {
      hook_event_name: 'PreToolUse',
      tool_name: 'Write',
      tool_use_id: 't',
      tool_input: { file_path: '/etc/passwd', content: 'x' },
      cwd: '/x',
      transcript_path: '/y'
    })
    expect(withExtras.event).toEqual({
      kind: 'tool-start',
      hookEventName: 'PreToolUse',
      toolName: 'Write',
      toolId: { kind: 'read', id: 't' },
      agentId: null
    })
  })
})

describe('parseAgentHookRequest(PostToolBatch)', () => {
  it('agent_id が無ければ batch-end', () => {
    expect(parse('PostToolBatch', { hook_event_name: 'PostToolBatch', session_id: 's' })).toEqual({
      event: { kind: 'batch-end', hookEventName: 'PostToolBatch', toolName: null },
      notes: []
    })
  })

  it('agent_id があれば confirm-only(subagent-batch-end。サブエージェントのバッチの終わりでメインの区間を閉じない)', () => {
    expect(parse('PostToolBatch', { hook_event_name: 'PostToolBatch', agent_id: 'ag-1' })).toEqual({
      event: {
        kind: 'confirm-only',
        reason: 'subagent-batch-end',
        hookEventName: 'PostToolBatch',
        toolName: null
      },
      notes: []
    })
  })

  it('agent_id の形が違えば confirm-only(bad-agent-id。notes に bad-agent-id)', () => {
    expect(parse('PostToolBatch', { hook_event_name: 'PostToolBatch', agent_id: 7 })).toEqual({
      event: {
        kind: 'confirm-only',
        reason: 'bad-agent-id',
        hookEventName: 'PostToolBatch',
        toolName: null
      },
      notes: ['bad-agent-id']
    })
  })

  it.each<[string, AgentHookBody, string[]]>([
    ['16 MiB を超えた', { kind: 'too-large' }, []],
    ['読み込みの失敗', { kind: 'unreadable' }, ['unreadable-body']],
    ['JSON でない', { kind: 'text', text: '{' }, ['unreadable-body']],
    ['イベント名がパスと違う', json({ hook_event_name: 'Stop' }), ['event-name-mismatch']]
  ])(
    '%s ときは confirm-only(batch-end-unreadable。区間を閉じる根拠にしない)',
    (_label, body, notes) => {
      expect(parseAgentHookRequest('PostToolBatch', body)).toEqual({
        event: {
          kind: 'confirm-only',
          reason: 'batch-end-unreadable',
          hookEventName: 'PostToolBatch',
          toolName: null
        },
        notes
      })
    }
  )
})

describe('parseAgentHookRequest(none を作らない。段階 3b)', () => {
  const EVENTS: AgentHookEventName[] = ['PreToolUse', 'PostToolUse', 'PostToolUseFailure']
  it.each(EVENTS)(
    '%s: 本文を読めても読めなくても、ツールの ID は read か unreadable(none は copilot だけ)',
    (event) => {
      const bodies: AgentHookBody[] = [
        json({ hook_event_name: event, tool_name: 'Edit', tool_use_id: 't1' }),
        json({ hook_event_name: event, tool_name: 'Edit' }),
        { kind: 'too-large' },
        { kind: 'unreadable' }
      ]
      const expectedKind = event === 'PreToolUse' ? 'tool-start' : 'tool-end'
      for (const body of bodies) {
        const { event: parsed } = parseAgentHookRequest(event, body)
        // どの本文もツールの知らせになることを先に確かめる(ツール以外になると toolId を確かめずに空振りで通るため)
        expect(parsed.kind).toBe(expectedKind)
        if (parsed.kind !== 'tool-start' && parsed.kind !== 'tool-end') continue
        expect(['read', 'unreadable']).toContain(parsed.toolId.kind)
      }
    }
  )
})
