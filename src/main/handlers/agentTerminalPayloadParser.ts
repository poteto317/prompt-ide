import type { AgentLaunchRequest, AgentStartRequest } from '@shared/types'
import { AGENT_CLI_KINDS, isAgentCliKind } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import {
  AGENT_SLOT_ID_MAX_LENGTH,
  AGENT_SLOT_ID_PATTERN,
  AGENT_TERMINAL_MAX_COLS,
  AGENT_TERMINAL_MAX_ROWS,
  AGENT_TERMINAL_MIN_COLS,
  AGENT_TERMINAL_MIN_ROWS,
  AGENT_WRITE_MAX_LENGTH,
  isClaudeSessionId
} from '@shared/types'
import { assertPlainObject, IPC_PATH_MAX_LENGTH, isIntegerInRange } from './payloadValidators'

// agentTerminal:* の入力の検証(設計書「入力の検証」)。invoke は例外で拒否し、send(write・resize・focus)は null を返して捨てる
// (send の listener で投げると main の例外の出力になるだけで、renderer には届かない)
// 起動の指定(launch)の claudeSessionId は形式を検証した値だけを starter へ渡し、starter はそのまま引数に使う(L-018)

const isSessionId = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** renderer が発行するタブ(枠)の id。通知の受け口(agentNotificationPayloadParser)も同じ規則で検証する */
export function parseAgentSlotId(value: unknown): string {
  if (typeof value !== 'string' || !AGENT_SLOT_ID_PATTERN.test(value)) {
    throw new Error(
      `slotId は英数字とハイフンの 1〜${AGENT_SLOT_ID_MAX_LENGTH} 文字である必要があります`
    )
  }
  return value
}

/** renderer が表示しているフォルダ(許可のフォルダとの一致の確認だけに使う)。起動・「前回」の取得で共有する */
export function parseAgentFolderPath(value: unknown): string {
  if (typeof value !== 'string' || value === '') {
    throw new Error('folderPath は空でない文字列である必要があります')
  }
  if (value.length > IPC_PATH_MAX_LENGTH) {
    throw new Error(`folderPath は ${IPC_PATH_MAX_LENGTH} 文字以下である必要があります`)
  }
  return value
}

/** エージェント CLI の種類(再開の依頼・「前回」の取得)。無い・知らない値は投げる(既定の claude に流さない。L-044) */
export function parseAgentCliKind(value: unknown): AgentCliKind {
  if (!isAgentCliKind(value)) {
    throw new Error(`cliKind は ${AGENT_CLI_KINDS.join('・')} のどれかである必要があります`)
  }
  return value
}

const hasOnlyKeys = (value: Record<string, unknown>, keys: readonly string[]): boolean =>
  Object.keys(value).every((key) => keys.includes(key))

/**
 * 起動の指定(新しく起動・記録した ID で再開)。無い・未知の kind・余分なキー・ID が小文字の UUID v4 でないもの・resume の種類が無い・知らない値は投げる
 * (既定の new に流さない。L-044。`-` 始まりの値が claude のオプションとして解釈される経路を断つ。L-034)
 */
export function parseAgentLaunchRequest(value: unknown): AgentLaunchRequest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('launch はオブジェクトである必要があります')
  }
  const launch = value as Record<string, unknown>
  if (launch.kind === 'new') {
    if (!hasOnlyKeys(launch, ['kind'])) throw new Error('launch に余分なキーがあります')
    return { kind: 'new' }
  }
  if (launch.kind === 'resume') {
    if (!hasOnlyKeys(launch, ['kind', 'claudeSessionId', 'cliKind'])) {
      throw new Error('launch に余分なキーがあります')
    }
    if (!isClaudeSessionId(launch.claudeSessionId)) {
      throw new Error('claudeSessionId は小文字の UUID v4 である必要があります')
    }
    return {
      kind: 'resume',
      claudeSessionId: launch.claudeSessionId,
      cliKind: parseAgentCliKind(launch.cliKind)
    }
  }
  throw new Error('launch.kind は new か resume である必要があります')
}

export function parseAgentStartRequest(payload: unknown): AgentStartRequest {
  assertPlainObject(payload)
  const { cols, rows } = payload
  const slotId = parseAgentSlotId(payload.slotId)
  const folderPath = parseAgentFolderPath(payload.folderPath)
  if (!isIntegerInRange(cols, AGENT_TERMINAL_MIN_COLS, AGENT_TERMINAL_MAX_COLS)) {
    throw new Error(
      `cols は ${AGENT_TERMINAL_MIN_COLS}〜${AGENT_TERMINAL_MAX_COLS} の整数である必要があります`
    )
  }
  if (!isIntegerInRange(rows, AGENT_TERMINAL_MIN_ROWS, AGENT_TERMINAL_MAX_ROWS)) {
    throw new Error(
      `rows は ${AGENT_TERMINAL_MIN_ROWS}〜${AGENT_TERMINAL_MAX_ROWS} の整数である必要があります`
    )
  }
  const launch = parseAgentLaunchRequest(payload.launch)
  return { slotId, folderPath, cols, rows, launch }
}

export function parseAgentSessionId(value: unknown): string {
  if (!isSessionId(value)) throw new Error('sessionId は空でない文字列である必要があります')
  return value
}

export function parseAgentWrite(
  sessionId: unknown,
  data: unknown
): { sessionId: string; data: string } | null {
  if (!isSessionId(sessionId)) return null
  // 長さは main では正規化(置換)をせずに数える。本文の正規化は renderer の送信の前に済ませ、ここは粗い上限だけを持つ
  if (typeof data !== 'string' || data.length > AGENT_WRITE_MAX_LENGTH) return null
  return { sessionId, data }
}

export function parseAgentResize(
  sessionId: unknown,
  cols: unknown,
  rows: unknown
): { sessionId: string; cols: number; rows: number } | null {
  if (!isSessionId(sessionId)) return null
  if (!isIntegerInRange(cols, AGENT_TERMINAL_MIN_COLS, AGENT_TERMINAL_MAX_COLS)) return null
  if (!isIntegerInRange(rows, AGENT_TERMINAL_MIN_ROWS, AGENT_TERMINAL_MAX_ROWS)) return null
  return { sessionId, cols, rows }
}
