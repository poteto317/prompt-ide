import type { AgentHookConfirmOnlyReason, AgentHookEvent } from '../../agentHookEvents'

// 追跡・区間の規則のテスト用の、解釈を終えた知らせ(AgentHookEvent)。本文の解釈の規則は写さず、型の形だけを組み立てる
// (本文からの解釈は agentHookEvents.test.ts)。id が null なら ID を読めなかった知らせ。idless* はツールの呼び出しの ID を持たない CLI の知らせ

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

export const batchEnd = (): AgentHookEvent => ({
  kind: 'batch-end',
  hookEventName: 'PostToolBatch',
  toolName: null
})

/** ツールの呼び出しの ID を持たない CLI(copilot)の tool-start。group は会話のグループ(null は主、文字列はサブエージェントの会話の ID) */
export const idlessToolStart = (group: string | null = null): AgentHookEvent => ({
  kind: 'tool-start',
  hookEventName: 'PreToolUse',
  toolName: 'Edit',
  toolId: { kind: 'none' },
  agentId: group
})

/** ツールの呼び出しの ID を持たない CLI(copilot)の tool-end */
export const idlessToolEnd = (group: string | null = null): AgentHookEvent => ({
  kind: 'tool-end',
  hookEventName: 'PostToolUse',
  toolName: 'Edit',
  toolId: { kind: 'none' },
  agentId: group
})

/** 理由を指定した confirm-only(hookEventName は区間の規則に使わないため UserPromptSubmit に固定する) */
export const confirmOnly = (reason: AgentHookConfirmOnlyReason): AgentHookEvent => ({
  kind: 'confirm-only',
  reason,
  hookEventName: 'UserPromptSubmit',
  toolName: null
})
