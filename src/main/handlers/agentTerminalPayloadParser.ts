import type { AgentStartRequest } from '@shared/types'
import {
  AGENT_SLOT_ID_MAX_LENGTH,
  AGENT_SLOT_ID_PATTERN,
  AGENT_TERMINAL_MAX_COLS,
  AGENT_TERMINAL_MAX_ROWS,
  AGENT_TERMINAL_MIN_COLS,
  AGENT_TERMINAL_MIN_ROWS,
  AGENT_WRITE_MAX_LENGTH
} from '@shared/types'
import { assertPlainObject, IPC_PATH_MAX_LENGTH } from './payloadValidators'

// agentTerminal:* の入力の検証(設計書「入力の検証」)。invoke は例外で拒否し、send(write・resize・focus)は null を返して捨てる
// (send の listener で投げると main の例外の出力になるだけで、renderer には届かない)

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

const isSessionId = (value: unknown): value is string => typeof value === 'string' && value !== ''

export function parseAgentStartRequest(payload: unknown): AgentStartRequest {
  assertPlainObject(payload)
  const { slotId, folderPath, cols, rows } = payload
  if (typeof slotId !== 'string' || !AGENT_SLOT_ID_PATTERN.test(slotId)) {
    throw new Error(
      `slotId は英数字とハイフンの 1〜${AGENT_SLOT_ID_MAX_LENGTH} 文字である必要があります`
    )
  }
  if (typeof folderPath !== 'string' || folderPath === '') {
    throw new Error('folderPath は空でない文字列である必要があります')
  }
  if (folderPath.length > IPC_PATH_MAX_LENGTH) {
    throw new Error(`folderPath は ${IPC_PATH_MAX_LENGTH} 文字以下である必要があります`)
  }
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
  return { slotId, folderPath, cols, rows }
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
