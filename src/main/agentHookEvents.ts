import { AGENT_HOOK_TOOL_NAMES } from './agentHookProtocol'
import type { AgentHookEventName } from './agentHookProtocol'

// hook の要求の本文の解釈(設計書「入力の解釈」。純粋な関数)。パスから決めたイベント(パスとの対応は agentHookProtocol.ts)と
// 本文を受け取り、本文を読めなければパスのイベントだけで扱う。使う欄は hook_event_name・tool_name・tool_use_id・agent_id だけで、
// tool_input・cwd・transcript_path などは読まない(区別は git の差分で行う。L-009・L-018)。どの結果も照合の通った知らせで、
// 追跡は受け取ったら確かめた状態を更新する

/** 読めた ID と、読めない(本文が大きすぎる・読めない・形が違う)を型で区別する */
export type ToolIdRead = { kind: 'read'; id: string } | { kind: 'unreadable' }

export type AgentHookConfirmOnlyReason =
  | 'prompt-submit'
  | 'unknown-tool-end'
  | 'bad-agent-id'
  | 'subagent-stop-without-agent'

/** hookEventName はパスから決めたイベント名。toolName は検証済みの名前(ツール以外のイベントは null。ログにだけ使う) */
export type AgentHookEvent = { hookEventName: AgentHookEventName; toolName: string | null } & (
  | { kind: 'confirm-only'; reason: AgentHookConfirmOnlyReason }
  | { kind: 'tool-start'; toolId: ToolIdRead; agentId: string | null }
  | { kind: 'tool-end'; toolId: ToolIdRead; agentId: string | null }
  | { kind: 'subagent-stop'; agentId: string }
  | { kind: 'turn-end' }
  | { kind: 'session-end' }
)

export type AgentHookBody =
  | { kind: 'text'; text: string }
  | { kind: 'too-large' }
  | { kind: 'unreadable' }

/** ログに出す理由(値は出さない) */
export type AgentHookParseNote =
  | 'unreadable-body'
  | 'event-name-mismatch'
  | 'unknown-tool-name'
  | 'bad-agent-id'

export interface AgentHookParseResult {
  event: AgentHookEvent
  notes: AgentHookParseNote[]
}

const ID_MAX_LENGTH = 256
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/

type AgentIdRead = { kind: 'absent' } | { kind: 'read'; id: string } | { kind: 'bad' }

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length >= 1 && value.length <= ID_MAX_LENGTH

function readAgentId(body: Record<string, unknown>): AgentIdRead {
  if (!('agent_id' in body) || body.agent_id === undefined) return { kind: 'absent' }
  return isId(body.agent_id) ? { kind: 'read', id: body.agent_id } : { kind: 'bad' }
}

function readBody(
  pathEvent: AgentHookEventName,
  body: AgentHookBody
): { value: Record<string, unknown> | null; notes: AgentHookParseNote[] } {
  if (body.kind === 'too-large') return { value: null, notes: [] }
  if (body.kind === 'unreadable') return { value: null, notes: ['unreadable-body'] }
  let parsed: unknown
  try {
    parsed = JSON.parse(body.text)
  } catch {
    return { value: null, notes: ['unreadable-body'] }
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { value: null, notes: ['unreadable-body'] }
  }
  const value = parsed as Record<string, unknown>
  // 本文のイベント名とパスのイベントを照らし合わせる(L-023)。違えばパスのイベントだけで扱う
  if (value.hook_event_name !== pathEvent) return { value: null, notes: ['event-name-mismatch'] }
  return { value, notes: [] }
}

/** 本文を読めないときの結果(パスのイベントだけ。ツールのイベントは ID なし) */
function eventWithoutBody(pathEvent: AgentHookEventName): AgentHookEvent {
  const base = { hookEventName: pathEvent, toolName: null }
  switch (pathEvent) {
    case 'UserPromptSubmit':
      return { ...base, kind: 'confirm-only', reason: 'prompt-submit' }
    case 'PreToolUse':
      return { ...base, kind: 'tool-start', toolId: { kind: 'unreadable' }, agentId: null }
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return { ...base, kind: 'tool-end', toolId: { kind: 'unreadable' }, agentId: null }
    case 'SubagentStop':
      return { ...base, kind: 'confirm-only', reason: 'subagent-stop-without-agent' }
    case 'Stop':
    case 'StopFailure':
      return { ...base, kind: 'turn-end' }
    case 'SessionEnd':
      return { ...base, kind: 'session-end' }
  }
}

export function parseAgentHookRequest(
  pathEvent: AgentHookEventName,
  body: AgentHookBody
): AgentHookParseResult {
  const { value, notes } = readBody(pathEvent, body)
  if (value === null) return { event: eventWithoutBody(pathEvent), notes }
  const base = { hookEventName: pathEvent, toolName: null }
  switch (pathEvent) {
    case 'UserPromptSubmit':
    case 'Stop':
    case 'StopFailure':
    case 'SessionEnd':
      return { event: eventWithoutBody(pathEvent), notes: [] }
    case 'SubagentStop': {
      const agent = readAgentId(value)
      if (agent.kind === 'absent') {
        return {
          event: { ...base, kind: 'confirm-only', reason: 'subagent-stop-without-agent' },
          notes: []
        }
      }
      if (agent.kind === 'bad') {
        return {
          event: { ...base, kind: 'confirm-only', reason: 'bad-agent-id' },
          notes: ['bad-agent-id']
        }
      }
      return { event: { ...base, kind: 'subagent-stop', agentId: agent.id }, notes: [] }
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return parseToolEvent(pathEvent, value)
  }
}

function parseToolEvent(
  pathEvent: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure',
  value: Record<string, unknown>
): AgentHookParseResult {
  const rawToolName = value.tool_name
  const toolName =
    typeof rawToolName === 'string' && TOOL_NAME_PATTERN.test(rawToolName) ? rawToolName : null
  const known = typeof rawToolName === 'string' && AGENT_HOOK_TOOL_NAMES.includes(rawToolName)
  const toolId: ToolIdRead = isId(value.tool_use_id)
    ? { kind: 'read', id: value.tool_use_id }
    : { kind: 'unreadable' }
  const agent = readAgentId(value)
  const base = { hookEventName: pathEvent, toolName }
  if (pathEvent === 'PreToolUse') {
    const notes: AgentHookParseNote[] = []
    // 知らない名前・形の違う agent_id でも区間を開く(捨てると、そのツールの書き込みが利用者の区間に入る。L-002)
    if (!known) notes.push('unknown-tool-name')
    if (agent.kind === 'bad') {
      notes.push('bad-agent-id')
      return {
        event: { ...base, kind: 'tool-start', toolId: { kind: 'unreadable' }, agentId: null },
        notes
      }
    }
    return {
      event: {
        ...base,
        kind: 'tool-start',
        toolId,
        agentId: agent.kind === 'read' ? agent.id : null
      },
      notes
    }
  }
  // 区間を閉じる知らせは、知らない名前・形の違う agent_id を根拠にしない(L-044)
  if (!known) {
    return {
      event: { ...base, kind: 'confirm-only', reason: 'unknown-tool-end' },
      notes: ['unknown-tool-name']
    }
  }
  if (agent.kind === 'bad') {
    return {
      event: { ...base, kind: 'confirm-only', reason: 'bad-agent-id' },
      notes: ['bad-agent-id']
    }
  }
  return {
    event: { ...base, kind: 'tool-end', toolId, agentId: agent.kind === 'read' ? agent.id : null },
    notes: []
  }
}
