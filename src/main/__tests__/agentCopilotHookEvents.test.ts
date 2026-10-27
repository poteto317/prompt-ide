import { describe, expect, it } from 'vitest'
import { parseCopilotHookRequest, resolveCopilotHookNotice } from '../agentCopilotHookEvents'
import { applyToolIntervalEvent, createToolIntervals, openCountOf } from '../agentToolIntervals'
import type {
  CopilotHookNotice,
  CopilotHookParseResult,
  CopilotMainSession
} from '../agentCopilotHookEvents'
import type { AgentHookBody, AgentHookConfirmOnlyReason, AgentHookEvent } from '../agentHookEvents'
import type { CopilotHookEventName } from '../agentHookProtocol'

// copilot の PascalCase の hooks の本文の解釈と、主の会話の ID による振り分け(設計書「入力の解釈と会話の ID の振り分け」)。
// 本文の形は記録(.superpowers/agent-cli-kind/copilot-hooks-recorder/report.md)の PascalCase の形

const MAIN = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const SUB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const NEW = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const SUB2 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const GRAND = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const KNOWN: CopilotMainSession = Object.freeze({ kind: 'known', id: MAIN })
const AWAITING: CopilotMainSession = Object.freeze({ kind: 'awaiting' })

const json = (value: unknown): AgentHookBody => ({ kind: 'text', text: JSON.stringify(value) })
const parse = (
  event: CopilotHookEventName,
  fields: Record<string, unknown>
): CopilotHookParseResult =>
  parseCopilotHookRequest(event, json({ hook_event_name: event, session_id: MAIN, ...fields }))

describe('parseCopilotHookRequest(7 つのイベント)', () => {
  it.each<[CopilotHookEventName, Record<string, unknown>, CopilotHookNotice]>([
    [
      'UserPromptSubmit',
      { prompt: 'hi', cwd: '/w', transcript_path: '/t' },
      { kind: 'prompt', hookEventName: 'UserPromptSubmit', toolName: null, sessionId: MAIN }
    ],
    [
      'PreToolUse',
      { tool_name: 'Edit', tool_input: { path: '/w/a.txt' } },
      { kind: 'tool-start', hookEventName: 'PreToolUse', toolName: 'Edit', sessionId: MAIN }
    ],
    [
      'PostToolUse',
      { tool_name: 'Write', tool_result: { ok: true } },
      { kind: 'tool-end', hookEventName: 'PostToolUse', toolName: 'Write', sessionId: MAIN }
    ],
    [
      'PostToolUseFailure',
      { tool_name: 'Bash' },
      { kind: 'tool-end', hookEventName: 'PostToolUseFailure', toolName: 'Bash', sessionId: MAIN }
    ],
    ['Stop', {}, { kind: 'stop', hookEventName: 'Stop', toolName: null, sessionId: MAIN }],
    [
      'SubagentStop',
      { agent_id: SUB },
      {
        kind: 'subagent-stop',
        hookEventName: 'SubagentStop',
        toolName: null,
        sessionId: MAIN,
        agentId: SUB
      }
    ],
    [
      'SessionEnd',
      { reason: 'clear' },
      { kind: 'session-end', hookEventName: 'SessionEnd', toolName: null, sessionId: MAIN }
    ]
  ])('%s', (event, fields, expected) => {
    expect(parse(event, fields)).toEqual({ notice: expected, notes: [] })
  })

  it.each([
    'apply_patch',
    'create',
    'edit',
    'bash',
    'powershell',
    'MultiEdit',
    'NotebookEdit',
    'PowerShell'
  ])(
    'copilot の名前・寄せた名前 %s も知っているツールとして扱う(tool-end を閉じる根拠にする)',
    (toolName) => {
      expect(parse('PostToolUse', { tool_name: toolName }).notice.kind).toBe('tool-end')
    }
  )

  it.each<[string, AgentHookBody, string[]]>([
    ['読めない', { kind: 'unreadable' }, ['unreadable-body']],
    ['大きすぎる', { kind: 'too-large' }, []],
    ['JSON でない', { kind: 'text', text: '{' }, ['unreadable-body']],
    ['配列', { kind: 'text', text: '[]' }, ['unreadable-body']]
  ])(
    '本文が %s とき: PreToolUse は session_id なしの tool-start(開く側。L-002)、ほかは copilot-body-unreadable(L-044)',
    (_label, body, notes) => {
      expect(parseCopilotHookRequest('PreToolUse', body)).toEqual({
        notice: {
          kind: 'tool-start',
          hookEventName: 'PreToolUse',
          toolName: null,
          sessionId: null
        },
        notes
      })
      for (const event of [
        'UserPromptSubmit',
        'PostToolUse',
        'PostToolUseFailure',
        'Stop',
        'SubagentStop',
        'SessionEnd'
      ] as const) {
        expect(parseCopilotHookRequest(event, body)).toEqual({
          notice: {
            kind: 'confirm-only',
            reason: 'copilot-body-unreadable',
            hookEventName: event,
            toolName: null,
            sessionId: null
          },
          notes
        })
      }
    }
  )

  it('本文のイベント名がパスと違えば、読めない本文と同じに扱い event-name-mismatch(L-023)', () => {
    expect(
      parseCopilotHookRequest(
        'PostToolUse',
        json({ hook_event_name: 'PreToolUse', session_id: MAIN, tool_name: 'Edit' })
      )
    ).toEqual({
      notice: {
        kind: 'confirm-only',
        reason: 'copilot-body-unreadable',
        hookEventName: 'PostToolUse',
        toolName: null,
        sessionId: null
      },
      notes: ['event-name-mismatch']
    })
    // camelCase の本文(hook_event_name が無い)も同じ
    expect(parseCopilotHookRequest('Stop', json({ sessionId: MAIN })).notes).toEqual([
      'event-name-mismatch'
    ])
  })

  it('知らない tool_name: PreToolUse は開き(unknown-tool-name)、PostToolUse* は unknown-tool-end の confirm-only', () => {
    expect(parse('PreToolUse', { tool_name: 'view' })).toEqual({
      notice: {
        kind: 'tool-start',
        hookEventName: 'PreToolUse',
        toolName: 'view',
        sessionId: MAIN
      },
      notes: ['unknown-tool-name']
    })
    for (const event of ['PostToolUse', 'PostToolUseFailure'] as const) {
      expect(parse(event, { tool_name: 'view' })).toEqual({
        notice: {
          kind: 'confirm-only',
          reason: 'unknown-tool-end',
          hookEventName: event,
          toolName: 'view',
          sessionId: MAIN
        },
        notes: ['unknown-tool-name']
      })
    }
    // 形の違う名前はログに出さない(toolName は null)
    expect(parse('PreToolUse', { tool_name: 'a b' }).notice.toolName).toBeNull()
  })

  it.each<[string, unknown]>([
    ['数', 1],
    ['空文字', ''],
    ['257 文字', 'x'.repeat(257)],
    ['オブジェクト', {}],
    ['無い', undefined]
  ])('session_id が %s なら sessionId は null(読めない。L-044)', (_label, value) => {
    expect(parse('Stop', { session_id: value }).notice.sessionId).toBeNull()
  })

  it('256 文字の session_id は読む', () => {
    expect(parse('Stop', { session_id: 'x'.repeat(256) }).notice.sessionId).toBe('x'.repeat(256))
  })

  it('SubagentStop の agent_id が無ければ subagent-stop-without-agent、形が違えば bad-agent-id の confirm-only', () => {
    expect(parse('SubagentStop', {}).notice).toEqual({
      kind: 'confirm-only',
      reason: 'subagent-stop-without-agent',
      hookEventName: 'SubagentStop',
      toolName: null,
      sessionId: MAIN
    })
    expect(parse('SubagentStop', { agent_id: 3 })).toEqual({
      notice: {
        kind: 'confirm-only',
        reason: 'bad-agent-id',
        hookEventName: 'SubagentStop',
        toolName: null,
        sessionId: MAIN
      },
      notes: ['bad-agent-id']
    })
  })
})

const prompt = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'prompt',
  hookEventName: 'UserPromptSubmit',
  toolName: null,
  sessionId
})
const pre = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'tool-start',
  hookEventName: 'PreToolUse',
  toolName: 'Edit',
  sessionId
})
const post = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'tool-end',
  hookEventName: 'PostToolUse',
  toolName: 'Edit',
  sessionId
})
const stop = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'stop',
  hookEventName: 'Stop',
  toolName: null,
  sessionId
})
const end = (sessionId: string | null): CopilotHookNotice => ({
  kind: 'session-end',
  hookEventName: 'SessionEnd',
  toolName: null,
  sessionId
})
const subagentStopOf = (agentId: string, sessionId: string | null = MAIN): CopilotHookNotice => ({
  kind: 'subagent-stop',
  hookEventName: 'SubagentStop',
  toolName: null,
  sessionId,
  agentId
})

const confirmEvent = (
  notice: CopilotHookNotice,
  reason: AgentHookConfirmOnlyReason
): AgentHookEvent => ({
  kind: 'confirm-only',
  reason,
  hookEventName: notice.hookEventName,
  toolName: notice.toolName
})
const idlessEvent = (
  kind: 'tool-start' | 'tool-end',
  hookEventName: 'PreToolUse' | 'PostToolUse',
  group: string | null
): AgentHookEvent => ({
  kind,
  hookEventName,
  toolName: 'Edit',
  toolId: { kind: 'none' },
  agentId: group
})
const TURN_END: AgentHookEvent = { kind: 'turn-end', hookEventName: 'Stop', toolName: null }
const SESSION_END: AgentHookEvent = {
  kind: 'session-end',
  hookEventName: 'SessionEnd',
  toolName: null
}

describe('resolveCopilotHookNotice(振り分けの表の全部のマス)', () => {
  it.each<[string, CopilotMainSession, CopilotHookNotice, AgentHookEvent, CopilotMainSession]>([
    // (3) 主の ID と同じ
    ['主: prompt', KNOWN, prompt(MAIN), confirmEvent(prompt(MAIN), 'prompt-submit'), KNOWN],
    ['主: tool-start', KNOWN, pre(MAIN), idlessEvent('tool-start', 'PreToolUse', null), KNOWN],
    ['主: tool-end', KNOWN, post(MAIN), idlessEvent('tool-end', 'PostToolUse', null), KNOWN],
    ['主: stop', KNOWN, stop(MAIN), TURN_END, KNOWN],
    ['主: session-end', KNOWN, end(MAIN), SESSION_END, AWAITING],
    // (3) 主の ID と違う(サブエージェント)
    ['サブ: prompt', KNOWN, prompt(SUB), confirmEvent(prompt(SUB), 'subagent-prompt'), KNOWN],
    ['サブ: tool-start', KNOWN, pre(SUB), idlessEvent('tool-start', 'PreToolUse', SUB), KNOWN],
    ['サブ: tool-end', KNOWN, post(SUB), idlessEvent('tool-end', 'PostToolUse', SUB), KNOWN],
    [
      'サブ: stop',
      KNOWN,
      stop(SUB),
      { kind: 'subagent-stop', hookEventName: 'Stop', toolName: null, agentId: SUB },
      KNOWN
    ],
    ['サブ: session-end', KNOWN, end(SUB), confirmEvent(end(SUB), 'other-session-end'), KNOWN],
    // (1) session_id を読めない(状態にかかわらず。状態は変えない)
    ...[KNOWN, AWAITING].flatMap(
      (
        main
      ): [string, CopilotMainSession, CopilotHookNotice, AgentHookEvent, CopilotMainSession][] => [
        [
          `読めない(${main.kind}): prompt`,
          main,
          prompt(null),
          confirmEvent(prompt(null), 'session-id-unreadable'),
          main
        ],
        [
          `読めない(${main.kind}): tool-start`,
          main,
          pre(null),
          idlessEvent('tool-start', 'PreToolUse', null),
          main
        ],
        [
          `読めない(${main.kind}): tool-end`,
          main,
          post(null),
          confirmEvent(post(null), 'session-id-unreadable'),
          main
        ],
        [
          `読めない(${main.kind}): stop`,
          main,
          stop(null),
          confirmEvent(stop(null), 'session-id-unreadable'),
          main
        ],
        [
          `読めない(${main.kind}): session-end`,
          main,
          end(null),
          confirmEvent(end(null), 'session-id-unreadable'),
          main
        ]
      ]
    ),
    // (2) 読めて、状態が awaiting
    [
      'awaiting: prompt',
      AWAITING,
      prompt(NEW),
      confirmEvent(prompt(NEW), 'prompt-submit'),
      { kind: 'known', id: NEW }
    ],
    [
      'awaiting: tool-start',
      AWAITING,
      pre(NEW),
      idlessEvent('tool-start', 'PreToolUse', null),
      AWAITING
    ],
    [
      'awaiting: tool-end',
      AWAITING,
      post(NEW),
      idlessEvent('tool-end', 'PostToolUse', null),
      AWAITING
    ],
    [
      'awaiting: stop',
      AWAITING,
      stop(NEW),
      confirmEvent(stop(NEW), 'stop-while-awaiting'),
      AWAITING
    ],
    [
      'awaiting: session-end',
      AWAITING,
      end(NEW),
      confirmEvent(end(NEW), 'other-session-end'),
      AWAITING
    ]
  ])('%s', (_label, main, notice, event, nextMain) => {
    expect(resolveCopilotHookNotice(main, notice)).toEqual({ event, main: nextMain })
  })

  it('SubagentStop は agent_id で決まる: known で主と違えば subagent-stop、主と同じなら session_id(親)を主に採り直す、awaiting は subagent-stop-unmatched', () => {
    expect(resolveCopilotHookNotice(KNOWN, subagentStopOf(SUB))).toEqual({
      event: { kind: 'subagent-stop', hookEventName: 'SubagentStop', toolName: null, agentId: SUB },
      main: KNOWN
    })
    expect(resolveCopilotHookNotice(KNOWN, subagentStopOf(SUB, null)).event.kind).toBe(
      'subagent-stop'
    )
    // 主として採っていた ID がサブエージェントのものだった(親の SubagentStop の agent_id になった)ので、その session_id(親)を主にする
    expect(resolveCopilotHookNotice(KNOWN, subagentStopOf(MAIN, NEW))).toEqual({
      event: confirmEvent(subagentStopOf(MAIN, NEW), 'main-was-subagent'),
      main: { kind: 'known', id: NEW }
    })
    // 親の session_id を読めない・agent_id と同じなら、次の主のプロンプトを待つ
    expect(resolveCopilotHookNotice(KNOWN, subagentStopOf(MAIN, null))).toEqual({
      event: confirmEvent(subagentStopOf(MAIN, null), 'main-was-subagent'),
      main: AWAITING
    })
    expect(resolveCopilotHookNotice(KNOWN, subagentStopOf(MAIN, MAIN))).toEqual({
      event: confirmEvent(subagentStopOf(MAIN, MAIN), 'main-was-subagent'),
      main: AWAITING
    })
    expect(resolveCopilotHookNotice(AWAITING, subagentStopOf(SUB))).toEqual({
      event: confirmEvent(subagentStopOf(SUB), 'subagent-stop-unmatched'),
      main: AWAITING
    })
  })

  it('解釈の confirm-only は、理由とツールの名前をそのまま渡し、状態を変えない', () => {
    const notice: CopilotHookNotice = {
      kind: 'confirm-only',
      reason: 'unknown-tool-end',
      hookEventName: 'PostToolUse',
      toolName: 'view',
      sessionId: MAIN
    }
    for (const main of [KNOWN, AWAITING]) {
      expect(resolveCopilotHookNotice(main, notice)).toEqual({
        event: confirmEvent(notice, 'unknown-tool-end'),
        main
      })
    }
  })
})

describe('resolveCopilotHookNotice(流れ)', () => {
  /** 知らせを順に振り分け、各結果の知らせと最後の状態を返す */
  function flow(
    start: CopilotMainSession,
    notices: CopilotHookNotice[]
  ): { events: AgentHookEvent[]; main: CopilotMainSession } {
    let main = start
    const events: AgentHookEvent[] = []
    for (const notice of notices) {
      const resolved = resolveCopilotHookNotice(main, notice)
      events.push(resolved.event)
      main = resolved.main
    }
    return { events, main }
  }

  it('/clear(記録 91): 主の SessionEnd → 新しい ID の prompt で採り直し → その ID の tool-start は主のグループ、Stop は turn-end', () => {
    const { events, main } = flow(KNOWN, [end(MAIN), prompt(NEW), pre(NEW), stop(NEW)])
    expect(events).toEqual([
      SESSION_END,
      confirmEvent(prompt(NEW), 'prompt-submit'),
      idlessEvent('tool-start', 'PreToolUse', null),
      TURN_END
    ])
    expect(main).toEqual({ kind: 'known', id: NEW })
  })

  it('--resume(記録 92): 再開した ID で known のまま、直後の別の ID の SessionEnd は other-session-end で状態を変えない', () => {
    const { events, main } = flow(KNOWN, [end(NEW), pre(MAIN), stop(MAIN)])
    expect(events).toEqual([
      confirmEvent(end(NEW), 'other-session-end'),
      idlessEvent('tool-start', 'PreToolUse', null),
      TURN_END
    ])
    expect(main).toBe(KNOWN)
  })

  it('列を選ぶ順の重なり: awaiting で session_id を読めない prompt・tool-end は「読めない」の列になり、awaiting のまま', () => {
    const { events, main } = flow(AWAITING, [prompt(null), post(null)])
    expect(events).toEqual([
      confirmEvent(prompt(null), 'session-id-unreadable'),
      confirmEvent(post(null), 'session-id-unreadable')
    ])
    expect(main).toEqual(AWAITING)
  })

  it('主のプロンプトの知らせが届かずにサブエージェントの ID を採っても、親の SubagentStop の session_id で主を採り直し、そのターンの主の Stop が turn-end になる', () => {
    const { events, main } = flow(AWAITING, [
      pre(MAIN),
      prompt(SUB),
      pre(SUB),
      post(SUB),
      stop(SUB),
      subagentStopOf(SUB, MAIN),
      post(MAIN),
      stop(MAIN)
    ])
    expect(events).toEqual([
      idlessEvent('tool-start', 'PreToolUse', null),
      // ここでサブエージェントの ID を主として採る(主のプロンプトとサブエージェントのプロンプトは区別できない)
      confirmEvent(prompt(SUB), 'prompt-submit'),
      idlessEvent('tool-start', 'PreToolUse', null),
      idlessEvent('tool-end', 'PostToolUse', null),
      TURN_END,
      // 採った ID が親の SubagentStop の agent_id になったので、その session_id(親)を主にする
      confirmEvent(subagentStopOf(SUB, MAIN), 'main-was-subagent'),
      idlessEvent('tool-end', 'PostToolUse', null),
      TURN_END
    ])
    expect(main).toEqual({ kind: 'known', id: MAIN })
  })

  it('並列のサブエージェントの 1 つ目の ID を採っても、採り直した後の 2 つ目の Stop・SubagentStop がそのグループを閉じ、区間が残らない', () => {
    const intervals = createToolIntervals()
    let main: CopilotMainSession = AWAITING
    const events: AgentHookEvent[] = []
    const notices = [
      pre(MAIN),
      prompt(SUB),
      prompt(SUB2),
      pre(SUB),
      pre(SUB2),
      post(SUB),
      stop(SUB),
      subagentStopOf(SUB, MAIN),
      post(SUB2),
      pre(SUB2),
      post(SUB2),
      stop(SUB2),
      subagentStopOf(SUB2, MAIN),
      post(MAIN),
      stop(MAIN)
    ]
    notices.forEach((notice, i) => {
      const resolved = resolveCopilotHookNotice(main, notice)
      main = resolved.main
      events.push(resolved.event)
      applyToolIntervalEvent(intervals, resolved.event, i)
    })
    expect(main).toEqual({ kind: 'known', id: MAIN })
    expect(events.slice(8, 13)).toEqual([
      idlessEvent('tool-end', 'PostToolUse', SUB2),
      idlessEvent('tool-start', 'PreToolUse', SUB2),
      idlessEvent('tool-end', 'PostToolUse', SUB2),
      { kind: 'subagent-stop', hookEventName: 'Stop', toolName: null, agentId: SUB2 },
      { kind: 'subagent-stop', hookEventName: 'SubagentStop', toolName: null, agentId: SUB2 }
    ])
    expect(events[14]).toEqual(TURN_END)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('入れ子: 子の ID を採っても、孫の SubagentStop は孫のグループを閉じ、子の SubagentStop で主を採り直す', () => {
    const intervals = createToolIntervals()
    let main: CopilotMainSession = AWAITING
    const notices = [
      pre(MAIN),
      prompt(SUB),
      pre(SUB),
      prompt(GRAND),
      pre(GRAND),
      post(GRAND),
      stop(GRAND),
      subagentStopOf(GRAND, SUB),
      post(SUB),
      stop(SUB),
      subagentStopOf(SUB, MAIN),
      post(MAIN),
      stop(MAIN)
    ]
    const events = notices.map((notice, i) => {
      const resolved = resolveCopilotHookNotice(main, notice)
      main = resolved.main
      applyToolIntervalEvent(intervals, resolved.event, i)
      return resolved.event
    })
    expect(events[7]).toEqual({
      kind: 'subagent-stop',
      hookEventName: 'SubagentStop',
      toolName: null,
      agentId: GRAND
    })
    expect(events[10]).toEqual(confirmEvent(subagentStopOf(SUB, MAIN), 'main-was-subagent'))
    expect(events[12]).toEqual(TURN_END)
    expect(main).toEqual({ kind: 'known', id: MAIN })
    expect(openCountOf(intervals)).toBe(0)
  })

  it('入れ子: 孫の ID を採っても、孫の SubagentStop で子、子の SubagentStop で主と、親をたどって採り直す', () => {
    const { main: afterGrand } = flow(AWAITING, [
      prompt(GRAND),
      stop(GRAND),
      subagentStopOf(GRAND, SUB)
    ])
    expect(afterGrand).toEqual({ kind: 'known', id: SUB })
    const { main: afterSub } = flow(afterGrand, [stop(SUB), subagentStopOf(SUB, MAIN)])
    expect(afterSub).toEqual({ kind: 'known', id: MAIN })
  })

  it('サブエージェント(記録 70): 中の prompt は主に触れず、中の Stop はそのグループの subagent-stop、親の SubagentStop も同じ ID', () => {
    const { events } = flow(KNOWN, [
      prompt(SUB),
      pre(SUB),
      post(SUB),
      stop(SUB),
      subagentStopOf(SUB),
      stop(MAIN)
    ])
    // 区間のグループと subagent-stop の agentId は、どれも中の session_id(SUB)
    expect(events).toEqual([
      confirmEvent(prompt(SUB), 'subagent-prompt'),
      idlessEvent('tool-start', 'PreToolUse', SUB),
      idlessEvent('tool-end', 'PostToolUse', SUB),
      { kind: 'subagent-stop', hookEventName: 'Stop', toolName: null, agentId: SUB },
      { kind: 'subagent-stop', hookEventName: 'SubagentStop', toolName: null, agentId: SUB },
      TURN_END
    ])
  })
})
