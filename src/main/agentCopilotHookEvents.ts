import { COPILOT_HOOK_TOOL_NAMES } from './agentHookProtocol'
import type { CopilotHookEventName } from './agentHookProtocol'
import {
  AGENT_HOOK_TOOL_NAME_PATTERN,
  isAgentHookId,
  readAgentHookAgentId,
  readAgentHookBodyObject
} from './agentHookEvents'
import type {
  AgentHookBody,
  AgentHookConfirmOnlyReason,
  AgentHookEvent,
  AgentHookParseNote
} from './agentHookEvents'

// copilot の PascalCase の hooks の本文の解釈と、主の会話の ID による振り分け(設計書 2026-10-26「入力の解釈と会話の ID の振り分け」。
// 純粋な関数)。本文の読み方(16 MiB の上限・JSON のオブジェクト・hook_event_name とパスのイベントの照らし合わせ)は claude と同じ。
// 使う欄は hook_event_name・session_id・tool_name・agent_id(SubagentStop だけ)で、tool_input・cwd・transcript_path・prompt・
// tool_result は読まない(区別は区間と判定の区切りの git の差分で行う。L-009・L-018)。copilot にはツールの呼び出しの ID が無いので、
// 区間は会話のグループ(AgentHookEvent の agentId。null は主)ごとの「ID を持たない区間」(toolId: none)として渡す。
// 主の会話の ID の状態は受け口のトークンの持ち主が持つ。「状態を読む → 振り分け → 状態を書く」は agentHookInterpretation.ts の
// interpretAgentHookRequest が行い、受け口(agentHookReceiver.ts)は本文を読み終えた後に await を挟まずにそれを呼んで deliver する

/** 解釈の結果。どれも読めた session_id(無い・形が違えば null)を持つ */
export type CopilotHookNotice = {
  hookEventName: CopilotHookEventName
  /** 検証済みのツールの名前(ツール以外のイベント・形の違う名前は null。ログにだけ使う) */
  toolName: string | null
  sessionId: string | null
} & (
  | { kind: 'prompt' }
  | { kind: 'tool-start' }
  | { kind: 'tool-end' }
  | { kind: 'stop' }
  /** 親の SubagentStop(本文の agent_id を読めたときだけ) */
  | { kind: 'subagent-stop'; agentId: string }
  | { kind: 'session-end' }
  | { kind: 'confirm-only'; reason: AgentHookConfirmOnlyReason }
)

export interface CopilotHookParseResult {
  notice: CopilotHookNotice
  notes: AgentHookParseNote[]
}

/**
 * タブの主の会話の ID。初めは起動に使った会話の ID(--session-id・--resume= に渡した小文字の UUID)で known。主の ID の
 * SessionEnd(/clear・copilot の中の /new・/resume)で awaiting になり、次の主のプロンプトの ID を採る(追跡の中だけ)。
 * agent_id が主の ID と同じ SubagentStop(awaiting の間に主のプロンプトの知らせが届かず、サブエージェントの ID を採っていた)では、
 * 本文の session_id(親の会話の ID)を読めればその ID で known に、読めない・agent_id と同じなら awaiting になる
 */
export type CopilotMainSession = { kind: 'known'; id: string } | { kind: 'awaiting' }

export interface CopilotHookResolution {
  /** 追跡に渡す知らせ */
  event: AgentHookEvent
  /** 次の状態(変わらなければ渡した値) */
  main: CopilotMainSession
}

/** 本文を読めないときの結果。PreToolUse は区間を開く側に倒し(L-002)、ほかは区間を閉じる根拠にしない(L-044) */
function noticeWithoutBody(event: CopilotHookEventName): CopilotHookNotice {
  const base = { hookEventName: event, toolName: null, sessionId: null }
  return event === 'PreToolUse'
    ? { ...base, kind: 'tool-start' }
    : { ...base, kind: 'confirm-only', reason: 'copilot-body-unreadable' }
}

export function parseCopilotHookRequest(
  event: CopilotHookEventName,
  body: AgentHookBody
): CopilotHookParseResult {
  const { value, notes } = readAgentHookBodyObject(event, body)
  if (value === null) return { notice: noticeWithoutBody(event), notes }
  const sessionId = isAgentHookId(value.session_id) ? value.session_id : null
  const base = { hookEventName: event, toolName: null, sessionId }
  switch (event) {
    case 'UserPromptSubmit':
      return { notice: { ...base, kind: 'prompt' }, notes: [] }
    case 'Stop':
      return { notice: { ...base, kind: 'stop' }, notes: [] }
    case 'SessionEnd':
      return { notice: { ...base, kind: 'session-end' }, notes: [] }
    case 'SubagentStop': {
      const agent = readAgentHookAgentId(value)
      if (agent.kind === 'absent') {
        return {
          notice: { ...base, kind: 'confirm-only', reason: 'subagent-stop-without-agent' },
          notes: []
        }
      }
      if (agent.kind === 'bad') {
        return {
          notice: { ...base, kind: 'confirm-only', reason: 'bad-agent-id' },
          notes: ['bad-agent-id']
        }
      }
      return { notice: { ...base, kind: 'subagent-stop', agentId: agent.id }, notes: [] }
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure': {
      const rawToolName = value.tool_name
      const toolName =
        typeof rawToolName === 'string' && AGENT_HOOK_TOOL_NAME_PATTERN.test(rawToolName)
          ? rawToolName
          : null
      const known = typeof rawToolName === 'string' && COPILOT_HOOK_TOOL_NAMES.includes(rawToolName)
      const toolBase = { ...base, toolName }
      // 知らない名前でも区間を開く(捨てると、そのツールの書き込みが利用者の区間に入る。L-002)
      if (event === 'PreToolUse') {
        return {
          notice: { ...toolBase, kind: 'tool-start' },
          notes: known ? [] : ['unknown-tool-name']
        }
      }
      // 区間を閉じる知らせは、知らない名前を根拠にしない(L-044)
      if (!known) {
        return {
          notice: { ...toolBase, kind: 'confirm-only', reason: 'unknown-tool-end' },
          notes: ['unknown-tool-name']
        }
      }
      return { notice: { ...toolBase, kind: 'tool-end' }, notes: [] }
    }
  }
}

/** 振り分けの表の列で決める知らせ */
type ColumnNotice = Extract<
  CopilotHookNotice,
  { kind: 'prompt' | 'tool-start' | 'tool-end' | 'stop' | 'session-end' }
>

const confirmOnlyEvent = (
  notice: CopilotHookNotice,
  reason: AgentHookConfirmOnlyReason
): AgentHookEvent => ({
  hookEventName: notice.hookEventName,
  toolName: notice.toolName,
  kind: 'confirm-only',
  reason
})

/** ID を持たない区間の知らせ(group は null が主、文字列はサブエージェントの会話の ID) */
const idlessEvent = (
  notice: CopilotHookNotice,
  kind: 'tool-start' | 'tool-end',
  group: string | null
): AgentHookEvent => ({
  hookEventName: notice.hookEventName,
  toolName: notice.toolName,
  kind,
  toolId: { kind: 'none' },
  agentId: group
})

/** (1) session_id を読めない: 状態にかかわらず。tool-start だけは主のグループで開く(L-002)、ほかは閉じる根拠にしない(L-044) */
function unreadableColumnEvent(notice: ColumnNotice): AgentHookEvent {
  switch (notice.kind) {
    case 'tool-start':
      return idlessEvent(notice, 'tool-start', null)
    case 'prompt':
    case 'tool-end':
    case 'stop':
    case 'session-end':
      return confirmOnlyEvent(notice, 'session-id-unreadable')
  }
}

/** (2) 読めて、状態が awaiting: 主のプロンプトでその ID を主にする。ツールは主のグループで数える */
function resolveAwaiting(
  main: Extract<CopilotMainSession, { kind: 'awaiting' }>,
  notice: ColumnNotice,
  sessionId: string
): CopilotHookResolution {
  switch (notice.kind) {
    case 'prompt':
      return {
        event: confirmOnlyEvent(notice, 'prompt-submit'),
        main: { kind: 'known', id: sessionId }
      }
    case 'tool-start':
      return { event: idlessEvent(notice, 'tool-start', null), main }
    case 'tool-end':
      return { event: idlessEvent(notice, 'tool-end', null), main }
    case 'stop':
      return { event: confirmOnlyEvent(notice, 'stop-while-awaiting'), main }
    case 'session-end':
      return { event: confirmOnlyEvent(notice, 'other-session-end'), main }
  }
}

/** (3) 読めて、状態が known: 主の ID と同じなら主、違えばその ID のサブエージェント */
function resolveKnown(
  main: Extract<CopilotMainSession, { kind: 'known' }>,
  notice: ColumnNotice,
  sessionId: string
): CopilotHookResolution {
  const isMain = sessionId === main.id
  const group = isMain ? null : sessionId
  const base = { hookEventName: notice.hookEventName, toolName: notice.toolName }
  switch (notice.kind) {
    case 'prompt':
      return { event: confirmOnlyEvent(notice, isMain ? 'prompt-submit' : 'subagent-prompt'), main }
    case 'tool-start':
      return { event: idlessEvent(notice, 'tool-start', group), main }
    case 'tool-end':
      return { event: idlessEvent(notice, 'tool-end', group), main }
    case 'stop':
      // サブエージェントの中の Stop はそのグループを閉じるだけで、親のターンの終わりにしない
      return {
        event: isMain
          ? { ...base, kind: 'turn-end' }
          : { ...base, kind: 'subagent-stop', agentId: sessionId },
        main
      }
    case 'session-end':
      // 主の SessionEnd(/clear など)で主の ID を待つ。別の ID(--resume の直後など)は区間・状態に触れない
      return isMain
        ? { event: { ...base, kind: 'session-end' }, main: { kind: 'awaiting' } }
        : { event: confirmOnlyEvent(notice, 'other-session-end'), main }
  }
}

/**
 * 解釈の結果を主の会話の ID の状態で振り分ける。列を選ぶ順は (1) session_id を読めない → (2) 状態が awaiting → (3) 状態が known
 * (主の ID と同じか)。SubagentStop の知らせの種類は本文の agent_id と状態(known で主の ID と違うか・同じか)で決まり、session_id は
 * agent_id が主の ID と同じときの採り直し先にだけ使う。
 * known で agent_id が主の ID と同じなら、awaiting の間に主のプロンプトの知らせが届かず、サブエージェントのプロンプトの ID を主として
 * 採っていた(記録 70 ではサブエージェントの中でも UserPromptSubmit が届く)ので、SubagentStop の session_id(記録 70 では親の会話の
 * ID)を主にする(並列のサブエージェントのグループを、そのグループの Stop・SubagentStop で閉じ続けるため)。読めない・agent_id と
 * 同じなら awaiting に戻して次の主のプロンプトで採り直す。
 * 解釈の confirm-only はそのまま渡す
 */
export function resolveCopilotHookNotice(
  main: CopilotMainSession,
  notice: CopilotHookNotice
): CopilotHookResolution {
  if (notice.kind === 'confirm-only') {
    return { event: confirmOnlyEvent(notice, notice.reason), main }
  }
  if (notice.kind === 'subagent-stop') {
    if (main.kind === 'known' && notice.agentId !== main.id) {
      return {
        event: {
          hookEventName: notice.hookEventName,
          toolName: notice.toolName,
          kind: 'subagent-stop',
          agentId: notice.agentId
        },
        main
      }
    }
    if (main.kind === 'known') {
      const parent = notice.sessionId
      return {
        event: confirmOnlyEvent(notice, 'main-was-subagent'),
        main:
          parent !== null && parent !== notice.agentId
            ? { kind: 'known', id: parent }
            : { kind: 'awaiting' }
      }
    }
    return { event: confirmOnlyEvent(notice, 'subagent-stop-unmatched'), main }
  }
  const sessionId = notice.sessionId
  if (sessionId === null) return { event: unreadableColumnEvent(notice), main }
  if (main.kind === 'awaiting') return resolveAwaiting(main, notice, sessionId)
  return resolveKnown(main, notice, sessionId)
}
