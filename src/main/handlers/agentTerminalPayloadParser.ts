import type { AgentStartRequest } from '@shared/types'
import {
  AGENT_TERMINAL_MAX_COLS,
  AGENT_TERMINAL_MAX_ROWS,
  AGENT_TERMINAL_MIN_COLS,
  AGENT_TERMINAL_MIN_ROWS,
  AGENT_WRITE_MAX_LENGTH
} from '@shared/types'
import { assertPlainObject } from './payloadValidators'

// agentTerminal:* の入力の検証(設計書「入力の検証」)。invoke は例外で拒否し、send(write・resize・focus)は null を返して捨てる
// (send の listener で投げると main の例外の出力になるだけで、renderer には届かない)

function isIntegerInRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max
}

/**
 * folderPath の長さの上限(UTF-16 の単位)。realpath などに巨大な文字列を渡さないための粗い事前の上限。
 * Windows の長いパスの上限(32,767)に合わせ、macOS・Linux の PATH_MAX(1,024・4,096)より十分に大きい
 */
export const AGENT_FOLDER_PATH_MAX_LENGTH = 32_767

const isSessionId = (value: unknown): value is string => typeof value === 'string' && value !== ''

export function parseAgentStartRequest(payload: unknown): AgentStartRequest {
  assertPlainObject(payload)
  const { folderPath, cols, rows } = payload
  if (typeof folderPath !== 'string' || folderPath === '') {
    throw new Error('folderPath は空でない文字列である必要があります')
  }
  if (folderPath.length > AGENT_FOLDER_PATH_MAX_LENGTH) {
    throw new Error(`folderPath は ${AGENT_FOLDER_PATH_MAX_LENGTH} 文字以下である必要があります`)
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
  return { folderPath, cols, rows }
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

/** 送信元がトップのフレーム(そのウィンドウのメインフレーム)か。iframe などのサブフレームからの依頼は受け付けない */
export function isMainFrameSender(event: { senderFrame: { parent: unknown } | null }): boolean {
  return event.senderFrame !== null && event.senderFrame.parent === null
}
