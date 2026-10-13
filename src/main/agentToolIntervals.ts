import type { AgentHookEvent } from './agentHookEvents'

// 1 つのセッションのツールの区間の開閉の規則(設計書「ツールの区間の追跡」。タイマーを持たない状態の更新)。ID のある区間・
// ID なしの区間・区間を閉じる知らせを待たずに外した ID の控えを持ち、知らせごとに開閉する。区間が開いたままになる側
// (利用者の編集をエージェントに数える)に倒し、知らない・読めない知らせで区間を閉じない(L-002・L-044)。
// 確かめた状態・猶予・期限切れのタイマー・ウィンドウの段階は agentToolActivity.ts

export const AGENT_TOOL_OPEN_MAX = 256
export const AGENT_DROPPED_TOOL_IDS_MAX = 1_024

export interface OpenInterval {
  openedAt: number
  expired: boolean
}

export interface IdInterval extends OpenInterval {
  agentId: string | null
}

export interface ToolIntervals {
  openTools: Map<string, IdInterval>
  anonymousOpen: OpenInterval[]
  /** 区間を閉じる知らせを待たずに外した ID(遅れた tool-end で別の区間を閉じないため) */
  droppedToolIds: Set<string>
}

export const createToolIntervals = (): ToolIntervals => ({
  openTools: new Map(),
  anonymousOpen: [],
  droppedToolIds: new Set()
})

/** 開いている区間(期限切れを含む) */
export const openIntervalsOf = (intervals: ToolIntervals): OpenInterval[] => [
  ...intervals.openTools.values(),
  ...intervals.anonymousOpen
]

export const openCountOf = (intervals: ToolIntervals): number =>
  intervals.openTools.size + intervals.anonymousOpen.length

/** 控えに足す(足し直した ID は新しい側へ)。上限を超えたら古い側から捨てる */
function remember(dropped: Set<string>, id: string): void {
  dropped.delete(id)
  dropped.add(id)
  while (dropped.size > AGENT_DROPPED_TOOL_IDS_MAX) {
    const oldest = dropped.values().next().value
    if (oldest === undefined) break
    dropped.delete(oldest)
  }
}

/** 知らせ 1 件で区間を開閉する。tool-start の openedAt は呼び出し側が渡す(confirm-only は何もしない) */
export function applyToolIntervalEvent(
  intervals: ToolIntervals,
  event: AgentHookEvent,
  now: number
): void {
  switch (event.kind) {
    case 'confirm-only':
      return
    case 'tool-start': {
      if (event.toolId.kind === 'read') {
        if (intervals.openTools.has(event.toolId.id)) return
        intervals.openTools.set(event.toolId.id, {
          agentId: event.agentId,
          openedAt: now,
          expired: false
        })
        if (intervals.openTools.size > AGENT_TOOL_OPEN_MAX) {
          const oldest = intervals.openTools.keys().next().value
          if (oldest !== undefined) {
            intervals.openTools.delete(oldest)
            remember(intervals.droppedToolIds, oldest)
          }
        }
        return
      }
      intervals.anonymousOpen.push({ openedAt: now, expired: false })
      if (intervals.anonymousOpen.length > AGENT_TOOL_OPEN_MAX) intervals.anonymousOpen.shift()
      return
    }
    case 'tool-end': {
      // (4) ID を読めない tool-end は何も閉じない
      if (event.toolId.kind !== 'read') return
      const id = event.toolId.id
      // (1) 開いた区間の終わり(期限切れでも同じ)
      if (intervals.openTools.delete(id)) return
      // (2) 外した区間の遅れた知らせは、控えから消すだけ
      if (intervals.droppedToolIds.delete(id)) return
      // (3) PreToolUse を読めなかった区間の終わりとみなし、ID なしの一番古い区間を閉じる
      intervals.anonymousOpen.shift()
      return
    }
    case 'subagent-stop':
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === event.agentId) intervals.openTools.delete(id)
      }
      return
    case 'turn-end':
      // 背景のサブエージェントは Stop の後も動くため、agent_id のある区間と ID なしの区間は閉じない
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === null) {
          intervals.openTools.delete(id)
          remember(intervals.droppedToolIds, id)
        }
      }
      return
    case 'session-end':
      // /clear・/resume でも届くため、セッションは外さず区間だけを閉じる
      for (const id of intervals.openTools.keys()) remember(intervals.droppedToolIds, id)
      intervals.openTools.clear()
      intervals.anonymousOpen = []
      return
  }
}

/** maxMs を過ぎた区間を外さずに期限切れにする */
export function markExpiredIntervals(intervals: ToolIntervals, now: number, maxMs: number): void {
  for (const interval of openIntervalsOf(intervals)) {
    if (!interval.expired && interval.openedAt + maxMs <= now) interval.expired = true
  }
}

/** 期限切れでない区間の一番早い openedAt(無ければ null) */
export function earliestUnexpiredOpenedAt(intervals: ToolIntervals): number | null {
  let earliest: number | null = null
  for (const interval of openIntervalsOf(intervals)) {
    if (!interval.expired && (earliest === null || interval.openedAt < earliest))
      earliest = interval.openedAt
  }
  return earliest
}
