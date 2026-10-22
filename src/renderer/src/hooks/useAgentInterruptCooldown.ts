import { useCallback, useEffect, useRef, useState } from 'react'
import { AGENT_INTERRUPT_COOLDOWN_MS } from '../lib/agentInterrupt'

// 帯の 中断 の、タブごとの「結果を待っている」と「押してから〈2 回目の要る種類は 2 回目の流れが終わってから数え直して〉
// AGENT_INTERRUPT_COOLDOWN_MS の待ち」の控え(useAgentInterrupt が使う)。
// 押した処理が読む最新の値(ref)と、描画が読む値(state)を両方持つ。待ちのタイマーはアンマウントですべて消す(L-052)

export interface AgentInterruptCooldown {
  /** 描画用: そのタブが結果を待っているか、1,000ms の待ちの間か(state。押せない理由の判定に使う) */
  isPending: (slotId: string) => boolean
  /** 押した処理用: そのタブの結果を待っているか(ref。同期の再入の防止) */
  isInFlight: (slotId: string) => boolean
  /** 押した処理用: そのタブが 1,000ms の待ちの間か(ref。常に最新) */
  isCoolingDown: (slotId: string) => boolean
  /** 送り始める: 結果を待っている状態にし、1,000ms の待ちを始める(前の待ちがあれば数え直す) */
  begin: (slotId: string) => void
  /** 結果が届いた(例外を含む): 結果を待っている状態を解く。1,000ms の待ちはタイマーが解く */
  finish: (slotId: string) => void
  /** 2 回目の流れが終わった(copilot): そのタブの 1,000ms の待ちを今から数え直す(前のタイマーを消す)。アンマウントの後は何もしない */
  restartCooldown: (slotId: string) => void
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

export function useAgentInterruptCooldown(): AgentInterruptCooldown {
  // 結果を待っているタブ。state は次の描画まで変わらないため ref(useAgentPromptSender の sendingRef と同じ考え)。
  // 集合はタブごとなので、タブ A の結果を待つ間でもタブ B は押せる
  const inFlightRef = useRef(new Set<string>())
  // 1,000ms の待ちのタイマー(タブごと)。押した処理は、これで 1,000ms 以内かを読む(常に最新)
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  // 描画用。結果を待っているタブ・1,000ms の待ちのタブ
  const [waitingSlots, setWaitingSlots] = useState<ReadonlySet<string>>(() => new Set())
  const [coolingSlots, setCoolingSlots] = useState<ReadonlySet<string>>(() => new Set())
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    const timers = timersRef.current
    return () => {
      mountedRef.current = false
      // アンマウントでタブごとの待ちのタイマーをすべて消す(L-052)
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
    }
  }, [])

  const isPending = (slotId: string): boolean =>
    waitingSlots.has(slotId) || coolingSlots.has(slotId)

  const isInFlight = useCallback((slotId: string): boolean => inFlightRef.current.has(slotId), [])

  const isCoolingDown = useCallback((slotId: string): boolean => timersRef.current.has(slotId), [])

  // そのタブの 1,000ms の待ちを今から始める(前のタイマーがあれば消して数え直す)
  const startCooldown = useCallback((slotId: string): void => {
    const timers = timersRef.current
    const previous = timers.get(slotId)
    if (previous !== undefined) clearTimeout(previous)
    timers.set(
      slotId,
      setTimeout(() => {
        timers.delete(slotId)
        if (mountedRef.current) setCoolingSlots((prev) => withSlot(prev, slotId, false))
      }, AGENT_INTERRUPT_COOLDOWN_MS)
    )
    setCoolingSlots((prev) => withSlot(prev, slotId, true))
  }, [])

  const begin = useCallback(
    (slotId: string): void => {
      inFlightRef.current.add(slotId)
      setWaitingSlots((prev) => withSlot(prev, slotId, true))
      startCooldown(slotId)
    },
    [startCooldown]
  )

  const restartCooldown = useCallback(
    (slotId: string): void => {
      // アンマウントの後はタイマーを残さない(L-052)
      if (!mountedRef.current) return
      startCooldown(slotId)
    },
    [startCooldown]
  )

  const finish = useCallback((slotId: string): void => {
    inFlightRef.current.delete(slotId)
    if (mountedRef.current) setWaitingSlots((prev) => withSlot(prev, slotId, false))
  }, [])

  return { isPending, isInFlight, isCoolingDown, begin, finish, restartCooldown }
}
