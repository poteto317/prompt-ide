import { describe, expect, it } from 'vitest'
import {
  AGENT_HOOK_EVENT_NAMES,
  AGENT_HOOK_TIMEOUT_SECONDS,
  AGENT_HOOK_TOOL_MATCHER,
  AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS,
  agentHookEventOfPath,
  agentHookPathOf
} from '../agentHookProtocol'
import { AGENT_PRE_TOOL_USE_WAIT_MS } from '../agentHookReceiver'

describe('agentHookProtocol(イベントとパス)', () => {
  it('渡すイベントは 9 つで、設定の JSON に書く順に並ぶ(PostToolBatch は PostToolUseFailure の後)', () => {
    expect(AGENT_HOOK_EVENT_NAMES).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'PostToolBatch',
      'SubagentStop',
      'Stop',
      'StopFailure',
      'SessionEnd'
    ])
  })

  it('9 つのイベントとパスを相互に引ける', () => {
    for (const event of AGENT_HOOK_EVENT_NAMES) {
      expect(agentHookEventOfPath(agentHookPathOf(event))).toBe(event)
    }
  })

  it('PostToolBatch のパスは /prompt-ide/agent-hooks/v1/post-tool-batch', () => {
    expect(agentHookPathOf('PostToolBatch')).toBe('/prompt-ide/agent-hooks/v1/post-tool-batch')
    expect(agentHookEventOfPath('/prompt-ide/agent-hooks/v1/post-tool-batch')).toBe('PostToolBatch')
  })

  it('パスは /prompt-ide/agent-hooks/v1/ にイベントのケバブケースを続ける', () => {
    expect(agentHookPathOf('PostToolUseFailure')).toBe(
      '/prompt-ide/agent-hooks/v1/post-tool-use-failure'
    )
  })

  it.each([
    '/prompt-ide/agent-hooks/v1/stop?x=1',
    '/prompt-ide/agent-hooks/v1/stop/',
    '/prompt-ide/agent-hooks/v1/session-start',
    '/prompt-ide/agent-hooks/v2/stop',
    '/PROMPT-IDE/agent-hooks/v1/stop',
    '/'
  ])('完全一致でないパス %s は null', (path) => {
    expect(agentHookEventOfPath(path)).toBeNull()
  })
})

describe('agentHookProtocol(matcher と timeout)', () => {
  it('matcher はファイルを書くツールとシェルの名前の完全一致の並び', () => {
    expect(AGENT_HOOK_TOOL_MATCHER).toBe('Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell')
  })

  it('PreToolUse の hook の timeout は受け口の待ちの上限より長い(claude 側で先に打ち切らない)', () => {
    expect(AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS * 1000).toBeGreaterThan(
      AGENT_PRE_TOOL_USE_WAIT_MS
    )
  })

  it('ほかのイベントの hook の timeout は 5 秒', () => {
    expect(AGENT_HOOK_TIMEOUT_SECONDS).toBe(5)
  })
})
