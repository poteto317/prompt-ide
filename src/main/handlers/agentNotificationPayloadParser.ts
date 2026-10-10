import type {
  AgentNotificationBadgeRequest,
  AgentNotificationDismissRequest,
  AgentNotificationShowRequest
} from '@shared/types'
import {
  AGENT_MAX_SESSIONS_PER_WINDOW,
  AGENT_NOTIFICATION_KINDS,
  isAgentNotificationKind
} from '@shared/types'
import { assertPlainObject, isIntegerInRange } from './payloadValidators'
import { parseAgentSlotId } from './agentTerminalPayloadParser'

// agentNotification:* の入力の検証(設計書「main」)。どれも invoke なので例外で拒否する。
// tabNumber は通知の題(claude N)にしか使わず、slotId との食い違いは押したときに届く先(slotId)を変えない(L-023)

export function parseAgentNotificationShowRequest(payload: unknown): AgentNotificationShowRequest {
  assertPlainObject(payload)
  const { tabNumber, kind } = payload
  const slotId = parseAgentSlotId(payload.slotId)
  if (!isIntegerInRange(tabNumber, 1, AGENT_MAX_SESSIONS_PER_WINDOW)) {
    throw new Error(`tabNumber は 1〜${AGENT_MAX_SESSIONS_PER_WINDOW} の整数である必要があります`)
  }
  if (!isAgentNotificationKind(kind)) {
    throw new Error(`kind は ${AGENT_NOTIFICATION_KINDS.join('・')} のどれかである必要があります`)
  }
  return { slotId, tabNumber, kind }
}

export function parseAgentNotificationBadgeRequest(
  payload: unknown
): AgentNotificationBadgeRequest {
  assertPlainObject(payload)
  const { count } = payload
  if (!isIntegerInRange(count, 0, AGENT_MAX_SESSIONS_PER_WINDOW)) {
    throw new Error(`count は 0〜${AGENT_MAX_SESSIONS_PER_WINDOW} の整数である必要があります`)
  }
  return { count }
}

export function parseAgentNotificationDismissRequest(
  payload: unknown
): AgentNotificationDismissRequest {
  assertPlainObject(payload)
  return { slotId: parseAgentSlotId(payload.slotId) }
}
