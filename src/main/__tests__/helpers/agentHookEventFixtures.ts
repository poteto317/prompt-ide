import type { AgentHookEvent } from '../../agentHookEvents'

// 追跡・区間の規則のテスト用の、解釈を終えた知らせ(AgentHookEvent)。本文の解釈の規則は写さず、型の形だけを組み立てる
// (本文からの解釈は agentHookEvents.test.ts)。id が null なら ID を読めなかった知らせ

export const promptSubmit = (): AgentHookEvent => ({
  kind: 'confirm-only',
  reason: 'prompt-submit',
  hookEventName: 'UserPromptSubmit',
  toolName: null
})

export const toolStart = (id: string | null, agentId: string | null = null): AgentHookEvent => ({
  kind: 'tool-start',
  hookEventName: 'PreToolUse',
  toolName: 'Edit',
  toolId: id === null ? { kind: 'unreadable' } : { kind: 'read', id },
  agentId
})

export const toolEnd = (id: string | null, agentId: string | null = null): AgentHookEvent => ({
  kind: 'tool-end',
  hookEventName: 'PostToolUse',
  toolName: 'Edit',
  toolId: id === null ? { kind: 'unreadable' } : { kind: 'read', id },
  agentId
})

export const subagentStop = (agentId: string): AgentHookEvent => ({
  kind: 'subagent-stop',
  hookEventName: 'SubagentStop',
  toolName: null,
  agentId
})

export const turnEnd = (): AgentHookEvent => ({
  kind: 'turn-end',
  hookEventName: 'Stop',
  toolName: null
})

export const sessionEnd = (): AgentHookEvent => ({
  kind: 'session-end',
  hookEventName: 'SessionEnd',
  toolName: null
})
