import { describe, expect, it } from 'vitest'
import {
  AGENT_HOOK_EVENT_NAMES,
  AGENT_HOOK_TIMEOUT_SECONDS,
  AGENT_HOOK_TOOL_MATCHER,
  AGENT_HOOK_TOOL_NAMES,
  AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS,
  COPILOT_HOOK_EVENT_NAMES,
  COPILOT_HOOK_TOOL_MATCHER,
  COPILOT_HOOK_TOOL_NAMES,
  agentHookEventOfPath,
  agentHookPathOf,
  agentHookRouteOfPath,
  agentHookTimeoutSecondsOf,
  copilotHookPathOf,
  isCopilotHookPath
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

  it('PreToolUse の hook の timeout は受け口の待ちの上限より長い(CLI〈claude・copilot〉の側で先に打ち切らない)', () => {
    expect(AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS * 1000).toBeGreaterThan(
      AGENT_PRE_TOOL_USE_WAIT_MS
    )
  })

  it('ほかのイベントの hook の timeout は 5 秒', () => {
    expect(AGENT_HOOK_TIMEOUT_SECONDS).toBe(5)
  })

  it('イベントごとの timeout は PreToolUse だけ長い値で、ほかの 8 つは 5 秒(claude・copilot の設定が同じ規則を引く)', () => {
    expect(agentHookTimeoutSecondsOf('PreToolUse')).toBe(AGENT_PRE_TOOL_USE_HOOK_TIMEOUT_SECONDS)
    for (const event of AGENT_HOOK_EVENT_NAMES.filter((name) => name !== 'PreToolUse')) {
      expect(agentHookTimeoutSecondsOf(event)).toBe(AGENT_HOOK_TIMEOUT_SECONDS)
    }
  })
})

describe('agentHookProtocol(copilot。段階 3b)', () => {
  it('copilot に渡すイベントは 7 つ(claude の 9 つから PostToolBatch・StopFailure を除いたもの)', () => {
    expect(COPILOT_HOOK_EVENT_NAMES).toEqual([
      'UserPromptSubmit',
      'PreToolUse',
      'PostToolUse',
      'PostToolUseFailure',
      'SubagentStop',
      'Stop',
      'SessionEnd'
    ])
  })

  it('copilot のパスは /prompt-ide/agent-hooks/copilot/v1/ に claude と同じ最後の段を続け、claude のパスと重ならない', () => {
    expect(copilotHookPathOf('PreToolUse')).toBe('/prompt-ide/agent-hooks/copilot/v1/pre-tool-use')
    expect(copilotHookPathOf('PostToolUseFailure')).toBe(
      '/prompt-ide/agent-hooks/copilot/v1/post-tool-use-failure'
    )
    for (const event of COPILOT_HOOK_EVENT_NAMES) {
      expect(copilotHookPathOf(event)).not.toBe(agentHookPathOf(event))
      expect(agentHookEventOfPath(copilotHookPathOf(event))).toBeNull()
    }
  })

  it('isCopilotHookPath は copilot の経路の前の部分で始まるパスだけ真(一致しないパスも含む)', () => {
    expect(isCopilotHookPath('/prompt-ide/agent-hooks/copilot/v1/stop')).toBe(true)
    expect(isCopilotHookPath('/prompt-ide/agent-hooks/copilot/v1/session-start')).toBe(true)
    expect(isCopilotHookPath('/prompt-ide/agent-hooks/copilot/v1/')).toBe(true)
    expect(isCopilotHookPath(agentHookPathOf('Stop'))).toBe(false)
    expect(isCopilotHookPath('/prompt-ide/agent-hooks/copilot/v2/stop')).toBe(false)
    expect(isCopilotHookPath('/other')).toBe(false)
  })

  it('知っているツールの名前は claude の名前に copilot の名前を足したもの。matcher はその並び', () => {
    expect(COPILOT_HOOK_TOOL_NAMES).toEqual([
      ...AGENT_HOOK_TOOL_NAMES,
      'bash',
      'powershell',
      'apply_patch',
      'create',
      'edit'
    ])
    expect(COPILOT_HOOK_TOOL_MATCHER).toBe(
      'Write|Edit|MultiEdit|NotebookEdit|Bash|PowerShell|bash|powershell|apply_patch|create|edit'
    )
    // 読むだけのツールとサブエージェントの呼び出しは数えない(claude で Read・Agent を数えないのと同じ)
    for (const name of ['view', 'rg', 'glob', 'task', 'Read', 'Agent']) {
      expect(COPILOT_HOOK_TOOL_NAMES).not.toContain(name)
    }
  })
})

describe('agentHookRouteOfPath(段階 3b)', () => {
  it('claude の 9 つのパスは claude の経路、copilot の 7 つのパスは copilot の経路', () => {
    for (const event of AGENT_HOOK_EVENT_NAMES) {
      expect(agentHookRouteOfPath(agentHookPathOf(event))).toEqual({ cliKind: 'claude', event })
    }
    for (const event of COPILOT_HOOK_EVENT_NAMES) {
      expect(agentHookRouteOfPath(copilotHookPathOf(event))).toEqual({ cliKind: 'copilot', event })
    }
  })

  it('どれにも完全一致しないパスは null(copilot の前の部分で始まるパス・クエリ付きを含む)', () => {
    expect(agentHookRouteOfPath('/prompt-ide/agent-hooks/copilot/v1/post-tool-batch')).toBeNull()
    expect(agentHookRouteOfPath('/prompt-ide/agent-hooks/copilot/v1/stop-failure')).toBeNull()
    expect(agentHookRouteOfPath('/prompt-ide/agent-hooks/copilot/v1/stop?x=1')).toBeNull()
    expect(agentHookRouteOfPath('/other')).toBeNull()
  })
})
