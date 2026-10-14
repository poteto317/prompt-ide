import type { AgentHookEvent } from './agentHookEvents'

// 1 つのセッションのツールの区間の開閉の規則(設計書「ツールの区間の追跡」「PostToolBatch で区間を閉じる」。タイマーを持たない
// 状態の更新)。ID のある区間・ID なしの区間・区間を閉じる知らせを待たずに外した ID の控え・上限を超えた印(overflowed)を持ち、
// 知らせごとに開閉する。割り当てられない区間(期限切れ・あふれ)の判定もここで行う。
// ID があって agent_id の無い区間は、自分の tool-end で「終わった」印(ended)を付けて開いたままにし、PostToolBatch で閉じる。
// 区間が開いたままになる側(利用者の編集をエージェントに数える)に倒し、知らない・読めない知らせで区間を閉じない(L-002・L-044)。
// 確かめた状態・猶予・期限切れのタイマー・ウィンドウの段階は agentToolActivity.ts

export const AGENT_TOOL_OPEN_MAX = 256
export const AGENT_DROPPED_TOOL_IDS_MAX = 1_024

export interface OpenInterval {
  openedAt: number
  expired: boolean
}

export interface IdInterval extends OpenInterval {
  agentId: string | null
  /** 自分の tool-end を受け、PostToolBatch を待っている(agent_id の無い区間だけ) */
  ended: boolean
}

export interface ToolIntervals {
  openTools: Map<string, IdInterval>
  anonymousOpen: OpenInterval[]
  /** 区間を閉じる知らせを待たずに外した ID(遅れた tool-end で別の区間を閉じないため) */
  droppedToolIds: Set<string>
  /** 上限(AGENT_TOOL_OPEN_MAX)を超える tool-start を受けた。どのエージェントの区間か分からないため、session-end と pty の終了でだけ下ろす */
  overflowed: boolean
}

export const createToolIntervals = (): ToolIntervals => ({
  openTools: new Map(),
  anonymousOpen: [],
  droppedToolIds: new Set(),
  overflowed: false
})

/** 開いている区間(期限切れ・ended を含む) */
export const openIntervalsOf = (intervals: ToolIntervals): OpenInterval[] => [
  ...intervals.openTools.values(),
  ...intervals.anonymousOpen
]

/** 開いた区間の数。あふれたセッションは開いた区間があるものとして 1 を足す */
export const openCountOf = (intervals: ToolIntervals): number =>
  intervals.openTools.size + intervals.anonymousOpen.length + (intervals.overflowed ? 1 : 0)

/** 割り当てられない区間がある(期限切れの区間がある・あふれた。設計書「段階 A の最終レビューで残した頑健性」の 4) */
export const hasUnassignableInterval = (intervals: ToolIntervals): boolean =>
  intervals.overflowed || openIntervalsOf(intervals).some((interval) => interval.expired)

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

/**
 * ID のある区間を、区間を閉じる知らせ(自分の tool-end)を待たずに外す。ended でない区間の ID は控える(遅れた tool-end が
 * 規則 (3) で ID なしの区間を閉じない。L-044)。ended の区間は自分の tool-end を受けた後なので控えない
 */
function dropIdInterval(intervals: ToolIntervals, id: string, interval: IdInterval): void {
  intervals.openTools.delete(id)
  if (!interval.ended) remember(intervals.droppedToolIds, id)
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
        if (intervals.openTools.size >= AGENT_TOOL_OPEN_MAX) {
          // 上限を超える区間は足さず、そのツールの遅れた tool-end で別の区間を閉じないよう ID を控える(まだ動いているツールの区間を早く閉じない。L-002)
          intervals.overflowed = true
          remember(intervals.droppedToolIds, event.toolId.id)
          return
        }
        intervals.openTools.set(event.toolId.id, {
          agentId: event.agentId,
          openedAt: now,
          expired: false,
          ended: false
        })
        return
      }
      if (intervals.anonymousOpen.length >= AGENT_TOOL_OPEN_MAX) {
        intervals.overflowed = true
        return
      }
      intervals.anonymousOpen.push({ openedAt: now, expired: false })
      return
    }
    case 'tool-end': {
      // (4) ID を読めない tool-end は何も閉じない
      if (event.toolId.kind !== 'read') return
      const id = event.toolId.id
      // (1) 開いた区間の終わり(期限切れでも同じ)。agent_id の無い区間は PostToolBatch まで開いたまま(既に ended なら何もしない)
      const interval = intervals.openTools.get(id)
      if (interval !== undefined) {
        if (interval.agentId === null) interval.ended = true
        else intervals.openTools.delete(id)
        return
      }
      // (2) 外した区間の遅れた知らせは、控えから消すだけ
      if (intervals.droppedToolIds.delete(id)) return
      // (3) PreToolUse を読めなかった区間の終わりとみなし、ID なしの一番古い区間を閉じる
      intervals.anonymousOpen.shift()
      return
    }
    case 'batch-end':
      // メインのエージェントのバッチの終わり。自分の tool-end を受けた区間だけを外す(期限切れでも同じ。ended なので控えない)。
      // ended でない区間(同じバッチで並行に動くツール)・agent_id のある区間・ID なしの区間は変えない
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === null && interval.ended) dropIdInterval(intervals, id, interval)
      }
      return
    case 'subagent-stop':
      // agent_id のある区間は ended にならないため、外した ID はすべて控える
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === event.agentId) dropIdInterval(intervals, id, interval)
      }
      return
    case 'turn-end':
      // 背景のサブエージェントは Stop の後も動くため、agent_id のある区間と ID なしの区間は閉じない
      for (const [id, interval] of intervals.openTools) {
        if (interval.agentId === null) dropIdInterval(intervals, id, interval)
      }
      return
    case 'session-end':
      // /clear・/resume でも届くため、セッションは外さず区間だけを閉じる
      for (const [id, interval] of intervals.openTools) dropIdInterval(intervals, id, interval)
      intervals.anonymousOpen = []
      intervals.overflowed = false
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
