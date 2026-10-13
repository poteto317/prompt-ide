import type { AgentHookEvent } from './agentHookEvents'
import {
  applyToolIntervalEvent,
  createToolIntervals,
  earliestUnexpiredOpenedAt,
  markExpiredIntervals,
  openCountOf,
  openIntervalsOf
} from './agentToolIntervals'
import type { ToolIntervals } from './agentToolIntervals'

// エージェントのツールの区間の追跡(設計書「ツールの区間の追跡」)。セッションごとに hooks が効いているか(pending・confirmed・
// unconfirmed)と開いた区間を持ち、ウィンドウ(所有者)ごとのあるべき段階(idle・agent・paused)と、区別をやめる合図(lost)・
// 割り当てられない合図(unassignable)を求める。合図が変わったら onPhaseChange を同期的に呼ぶ(段階 A は何もしない)。
// ここは確かめた状態・タイマー(作業中の知らせからの 15 秒・15 分の期限切れ・ツールの終わりの猶予)・段階・通し番号・開発版のログを
// 持ち、区間の開閉の規則は agentToolIntervals.ts

export const AGENT_TOOL_END_GRACE_MS = 2_000
export const AGENT_TOOL_INTERVAL_MAX_MS = 15 * 60 * 1000
export const AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS = 15_000

export type AgentHooksUnavailableReason = 'receiver-unavailable' | 'claude-version-unsupported'
export type AgentHooksLostReason = 'hooks-not-confirmed' | AgentHooksUnavailableReason
export type AgentToolPhase = 'idle' | 'agent' | 'paused'

export interface AgentToolActivitySignal {
  phase: AgentToolPhase
  lost: AgentHooksLostReason | null
  unassignable: boolean
}

export type AgentHookSessionInitialState =
  | { kind: 'pending' }
  | { kind: 'unconfirmed'; reason: AgentHooksUnavailableReason }

export interface AgentToolActivityDeps {
  /** ウィンドウの合図(activityOf の値)が変わったときに同期的に呼ぶ(段階 A は何もしない。段階 B で syncAttribution につなぐ) */
  onPhaseChange(ownerId: number): void
  /** 開発版のログ(1 行ずつ)。null なら出さない */
  devLog: ((line: string) => void) | null
  /** 常に出すログ */
  warn(message: string): void
}

export interface AgentToolActivity {
  addSession(ownerId: number, sessionId: string, state: AgentHookSessionInitialState): void
  removeSession(ownerId: number, sessionId: string): void
  deliver(ownerId: number, sessionId: string, event: AgentHookEvent): void
  reportWorking(ownerId: number, sessionId: string): void
  activityOf(ownerId: number): AgentToolActivitySignal
  toolStartSeqOf(ownerId: number): number
  close(): void
}

type Timer = ReturnType<typeof setTimeout>
type HooksState =
  | { kind: 'pending' }
  | { kind: 'confirmed' }
  | { kind: 'unconfirmed'; reason: AgentHooksLostReason }

interface SessionState {
  hooks: HooksState
  /** pending の間に作業中の知らせを受けて張った 15 秒のタイマー */
  workingTimer: Timer | null
  intervals: ToolIntervals
}

interface OwnerState {
  sessions: Map<string, SessionState>
  graceTimer: Timer | null
  expiryTimer: Timer | null
  lastSignal: AgentToolActivitySignal
}

/** ログの 1 行の中身(イベントの名前・ツールの名前・ID の有無・agent_id の有無) */
interface LogDetail {
  sessionId: string | null
  event: string
  tool?: string | null
  hasId?: boolean
  hasAgent?: boolean
}

const PAUSED: AgentToolActivitySignal = { phase: 'paused', lost: null, unassignable: false }

const startTimer = (fn: () => void, ms: number): Timer => {
  const handle = setTimeout(fn, ms)
  handle.unref()
  return handle
}

const sameSignal = (a: AgentToolActivitySignal, b: AgentToolActivitySignal): boolean =>
  a.phase === b.phase && a.lost === b.lost && a.unassignable === b.unassignable

/** 所有者のすべてのセッションの開いた区間の数 */
const ownerOpenCountOf = (owner: OwnerState): number =>
  [...owner.sessions.values()].reduce((sum, s) => sum + openCountOf(s.intervals), 0)

function signalOf(owner: OwnerState | undefined): AgentToolActivitySignal {
  if (owner === undefined || owner.sessions.size === 0) return PAUSED
  const sessions = [...owner.sessions.values()]
  // 段階の分岐と別に、生きているセッションのどれかに期限切れの区間が残っているかで求める
  const unassignable = sessions.some((s) =>
    openIntervalsOf(s.intervals).some((interval) => interval.expired)
  )
  for (const session of sessions) {
    if (session.hooks.kind === 'unconfirmed')
      return { phase: 'agent', lost: session.hooks.reason, unassignable }
  }
  if (sessions.some((s) => s.hooks.kind === 'pending'))
    return { phase: 'agent', lost: null, unassignable }
  const confirmed = sessions.filter((s) => s.hooks.kind === 'confirmed')
  if (confirmed.length === 0) return { phase: 'paused', lost: null, unassignable }
  const open = confirmed.some((s) => openCountOf(s.intervals) > 0)
  if (open || owner.graceTimer !== null) return { phase: 'agent', lost: null, unassignable }
  return { phase: 'idle', lost: null, unassignable }
}

const hooksLabel = (session: SessionState | undefined): string => {
  if (session === undefined) return '-'
  return session.hooks.kind === 'unconfirmed'
    ? `unconfirmed(${session.hooks.reason})`
    : session.hooks.kind
}

const flag = (value: boolean | undefined): string =>
  value === undefined ? '-' : value ? 'あり' : 'なし'

export function createAgentToolActivity({
  onPhaseChange,
  devLog,
  warn
}: AgentToolActivityDeps): AgentToolActivity {
  const owners = new Map<number, OwnerState>()
  const toolStartSeq = new Map<number, number>()

  const writeLog = (
    ownerId: number,
    detail: LogDetail,
    session: SessionState | undefined,
    before: AgentToolPhase,
    after: AgentToolPhase
  ): void => {
    if (devLog === null) return
    const sessionLabel = detail.sessionId === null ? '-' : detail.sessionId.slice(0, 8)
    devLog(
      `[agent-hooks] owner=${ownerId} session=${sessionLabel} event=${detail.event} tool=${detail.tool ?? '-'} ` +
        `id=${flag(detail.hasId)} agent=${flag(detail.hasAgent)} hooks=${hooksLabel(session)} phase=${before}→${after}`
    )
  }

  /** 合図を求め直し、ログを出し、変わっていれば onPhaseChange を呼ぶ */
  const publish = (ownerId: number, owner: OwnerState, detail: LogDetail): void => {
    const before = owner.lastSignal
    const after = signalOf(owner)
    const session = detail.sessionId === null ? undefined : owner.sessions.get(detail.sessionId)
    writeLog(ownerId, detail, session, before.phase, after.phase)
    if (sameSignal(before, after)) return
    owner.lastSignal = after
    onPhaseChange(ownerId)
  }

  const clearGrace = (owner: OwnerState): void => {
    if (owner.graceTimer !== null) clearTimeout(owner.graceTimer)
    owner.graceTimer = null
  }

  const startGrace = (ownerId: number, owner: OwnerState): void => {
    clearGrace(owner)
    owner.graceTimer = startTimer(() => {
      owner.graceTimer = null
      publish(ownerId, owner, { sessionId: null, event: '猶予の終わり' })
    }, AGENT_TOOL_END_GRACE_MS)
  }

  const clearExpiry = (owner: OwnerState): void => {
    if (owner.expiryTimer !== null) clearTimeout(owner.expiryTimer)
    owner.expiryTimer = null
  }

  /** 期限切れのタイマーを、期限切れでない区間の一番早い期限に張り直す(所有者ごとに 1 つ) */
  const scheduleExpiry = (ownerId: number, owner: OwnerState): void => {
    clearExpiry(owner)
    let earliest = Infinity
    for (const session of owner.sessions.values()) {
      earliest = Math.min(earliest, earliestUnexpiredOpenedAt(session.intervals) ?? Infinity)
    }
    if (earliest === Infinity) return
    owner.expiryTimer = startTimer(
      () => {
        owner.expiryTimer = null
        const now = Date.now()
        for (const session of owner.sessions.values()) {
          markExpiredIntervals(session.intervals, now, AGENT_TOOL_INTERVAL_MAX_MS)
        }
        scheduleExpiry(ownerId, owner)
        publish(ownerId, owner, { sessionId: null, event: 'interval-expired' })
      },
      Math.max(0, earliest + AGENT_TOOL_INTERVAL_MAX_MS - Date.now())
    )
  }

  /** 区間の数が 0 になった時点(どの閉じ方でも)から猶予を数え、期限切れを張り直し、合図を出す */
  const afterMutation = (
    ownerId: number,
    owner: OwnerState,
    openBefore: number,
    detail: LogDetail
  ): void => {
    if (openBefore > 0 && ownerOpenCountOf(owner) === 0) startGrace(ownerId, owner)
    scheduleExpiry(ownerId, owner)
    publish(ownerId, owner, detail)
  }

  /** pending の間の作業中の知らせからの 15 秒のタイマーを外す */
  const clearWorkingTimer = (session: SessionState): void => {
    if (session.workingTimer !== null) clearTimeout(session.workingTimer)
    session.workingTimer = null
  }

  /** どの知らせでも、pending・unconfirmed(hooks-not-confirmed)なら confirmed にする */
  const confirm = (session: SessionState): void => {
    if (
      session.hooks.kind === 'pending' ||
      (session.hooks.kind === 'unconfirmed' && session.hooks.reason === 'hooks-not-confirmed')
    ) {
      session.hooks = { kind: 'confirmed' }
      clearWorkingTimer(session)
    }
  }

  /** 知らせ 1 件を区間に当てる。tool-start は重複した ID でも通し番号を進め、猶予を取り消す */
  const apply = (
    ownerId: number,
    owner: OwnerState,
    session: SessionState,
    event: AgentHookEvent
  ): void => {
    if (event.kind === 'tool-start') {
      toolStartSeq.set(ownerId, (toolStartSeq.get(ownerId) ?? 0) + 1)
      clearGrace(owner)
    }
    applyToolIntervalEvent(session.intervals, event, Date.now())
  }

  const detailOf = (sessionId: string, event: AgentHookEvent): LogDetail => {
    const hasId =
      event.kind === 'tool-start' || event.kind === 'tool-end'
        ? event.toolId.kind === 'read'
        : undefined
    const hasAgent =
      event.kind === 'tool-start' || event.kind === 'tool-end'
        ? event.agentId !== null
        : event.kind === 'subagent-stop'
          ? true
          : undefined
    return { sessionId, event: event.hookEventName, tool: event.toolName, hasId, hasAgent }
  }

  return {
    addSession(ownerId, sessionId, state) {
      let owner = owners.get(ownerId)
      if (owner === undefined) {
        owner = { sessions: new Map(), graceTimer: null, expiryTimer: null, lastSignal: PAUSED }
        owners.set(ownerId, owner)
      }
      owner.sessions.set(sessionId, {
        hooks:
          state.kind === 'pending'
            ? { kind: 'pending' }
            : { kind: 'unconfirmed', reason: state.reason },
        workingTimer: null,
        intervals: createToolIntervals()
      })
      publish(ownerId, owner, { sessionId, event: '起動' })
    },
    removeSession(ownerId, sessionId) {
      const owner = owners.get(ownerId)
      const session = owner?.sessions.get(sessionId)
      if (owner === undefined || session === undefined) return
      const openBefore = ownerOpenCountOf(owner)
      clearWorkingTimer(session)
      owner.sessions.delete(sessionId)
      if (owner.sessions.size === 0) {
        clearGrace(owner)
        clearExpiry(owner)
        owners.delete(ownerId)
      }
      afterMutation(ownerId, owner, owner.sessions.size === 0 ? 0 : openBefore, {
        sessionId,
        event: '終了'
      })
    },
    deliver(ownerId, sessionId, event) {
      const owner = owners.get(ownerId)
      const session = owner?.sessions.get(sessionId)
      if (owner === undefined || session === undefined) return
      const openBefore = ownerOpenCountOf(owner)
      confirm(session)
      apply(ownerId, owner, session, event)
      afterMutation(ownerId, owner, openBefore, detailOf(sessionId, event))
    },
    reportWorking(ownerId, sessionId) {
      const owner = owners.get(ownerId)
      const session = owner?.sessions.get(sessionId)
      if (owner === undefined || session === undefined) {
        warn('[agent-hooks] 作業中の知らせのセッションが見つかりません')
        return
      }
      if (session.hooks.kind !== 'pending' || session.workingTimer !== null) return
      session.workingTimer = startTimer(() => {
        session.workingTimer = null
        if (session.hooks.kind !== 'pending' || owner.sessions.get(sessionId) !== session) return
        session.hooks = { kind: 'unconfirmed', reason: 'hooks-not-confirmed' }
        warn('[agent-hooks] hooks の知らせが届かないため、区別をやめます')
        publish(ownerId, owner, { sessionId, event: '確認の待ちの終わり' })
      }, AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
      publish(ownerId, owner, { sessionId, event: '作業中' })
    },
    activityOf(ownerId) {
      return signalOf(owners.get(ownerId))
    },
    toolStartSeqOf(ownerId) {
      return toolStartSeq.get(ownerId) ?? 0
    },
    close() {
      for (const owner of owners.values()) {
        clearGrace(owner)
        clearExpiry(owner)
        for (const session of owner.sessions.values()) clearWorkingTimer(session)
      }
      owners.clear()
    }
  }
}
