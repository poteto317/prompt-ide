// src/renderer/src/hooks/useAgentPermissionAnswerCooldown.ts
import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_PERMISSION_ANSWER_COOLDOWN_MS } from '../lib/agentPermissionAnswer'

// 帯の 許可・拒否 の、タブごとの「送っている途中」「押してから AGENT_PERMISSION_ANSWER_COOLDOWN_MS の待ち」「送った後の画面の読み直し待ち」の
// 控え(設計書 2026-11-06「押したときの処理」)。useAgentWorkspace が中断の hook と答えの hook より先に作り、両方へ渡す(中断も答えた直後は
// 押せない)。押した処理が読む最新の値(ref)と、描画が読む値(state)を両方持つ。作りは useAgentInterruptCooldown と同じで、
// restartCooldown は持たない。待ちのタイマーはアンマウントですべて消す(L-052)

export interface AgentPermissionAnswerCooldown {
  /** 描画用(state): 送っている途中・1,000ms・読み直し待ちのどれか。答えと中断の押せない理由に使う */
  isPending: (slotId: string) => boolean
  /** 押した時点用(ref。参照は安定): isPending と同じ間 */
  isPendingNow: (slotId: string) => boolean
  /** 押した時点用(ref。参照は安定): 送っている途中(同期の再入の防止。L-101・L-653) */
  isInFlight: (slotId: string) => boolean
  /** 描画用(state): 送った後の画面の読み直し待ち(useAgentPermissionPrompt が見る) */
  isAwaitingReread: (slotId: string) => boolean
  /** 送り始める: 3 つを同時に始める(1,000ms のタイマーは数え直す) */
  begin: (slotId: string) => void
  /** 結果が届いた(例外を含む): 送っている途中だけを解く */
  finish: (slotId: string) => void
  /** 送った後の画面を読み直した(または読む必要が無くなった): 読み直し待ちを解く。待ちでなければ何もしない */
  markReread: (slotId: string) => void
}

const withSlot = (
  set: ReadonlySet<string>,
  slotId: string,
  present: boolean
): ReadonlySet<string> => {
  if (set.has(slotId) === present) return set
  const next = new Set(set)
  if (present) next.add(slotId)
  else next.delete(slotId)
  return next
}

export function useAgentPermissionAnswerCooldown(): AgentPermissionAnswerCooldown {
  // 押した時点用の控え(state は次の描画まで変わらないため ref)。集合はタブごと
  const inFlightRef = useRef(new Set<string>())
  const awaitingRef = useRef(new Set<string>())
  // 1,000ms の待ちのタイマー(タブごと)。押した処理は、これで 1,000ms 以内かを読む
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // 描画用
  const [inFlightSlots, setInFlightSlots] = useState<ReadonlySet<string>>(() => new Set())
  const [coolingSlots, setCoolingSlots] = useState<ReadonlySet<string>>(() => new Set())
  const [awaitingSlots, setAwaitingSlots] = useState<ReadonlySet<string>>(() => new Set())
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    const timers = timersRef.current
    return () => {
      mountedRef.current = false
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const isPending = (slotId: string): boolean =>
    inFlightSlots.has(slotId) || coolingSlots.has(slotId) || awaitingSlots.has(slotId)

  const isAwaitingReread = (slotId: string): boolean => awaitingSlots.has(slotId)

  const isInFlight = useCallback((slotId: string): boolean => inFlightRef.current.has(slotId), [])

  // isPending の ref 版。描画用と同じ 3 つの和を同じファイルで決め、片方だけ変えて食い違わないようにする
  const isPendingNow = useCallback(
    (slotId: string): boolean =>
      inFlightRef.current.has(slotId) ||
      timersRef.current.has(slotId) ||
      awaitingRef.current.has(slotId),
    []
  )

  const begin = useCallback((slotId: string): void => {
    inFlightRef.current.add(slotId)
    awaitingRef.current.add(slotId)
    const timers = timersRef.current
    const previous = timers.get(slotId)
    if (previous !== undefined) clearTimeout(previous)
    timers.set(
      slotId,
      setTimeout(() => {
        timers.delete(slotId)
        if (mountedRef.current) setCoolingSlots((prev) => withSlot(prev, slotId, false))
      }, AGENT_PERMISSION_ANSWER_COOLDOWN_MS)
    )
    setInFlightSlots((prev) => withSlot(prev, slotId, true))
    setCoolingSlots((prev) => withSlot(prev, slotId, true))
    setAwaitingSlots((prev) => withSlot(prev, slotId, true))
  }, [])

  const finish = useCallback((slotId: string): void => {
    inFlightRef.current.delete(slotId)
    if (mountedRef.current) setInFlightSlots((prev) => withSlot(prev, slotId, false))
  }, [])

  const markReread = useCallback((slotId: string): void => {
    // 待ちでないタブは何もしない(描画を増やさない)
    if (!awaitingRef.current.delete(slotId)) return
    if (mountedRef.current) setAwaitingSlots((prev) => withSlot(prev, slotId, false))
  }, [])

  return { isPending, isPendingNow, isInFlight, isAwaitingReread, begin, finish, markReread }
}
