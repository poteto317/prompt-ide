import { useCallback, useEffect, useRef } from 'react'
import type { Announcement } from '../types'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import { checkAgentInterruptAtPress, getAgentInterruptAvailability } from '../lib/agentInterrupt'
import type { AgentInterruptAvailabilityInput } from '../lib/agentInterrupt'
import { agentInterruptSentNotice } from '../lib/agentInterruptMessages'
import type { AgentInterruptOutcome, AgentSessionTabView } from './useAgentSessions'
import { useAgentInterruptCooldown } from './useAgentInterruptCooldown'
import { useLatestRef } from './useLatestRef'
import { useTransientNotice } from './useTransientNotice'

// 帯の 中断 の押した処理と読み上げ(設計書 2026-10-19「押したときの処理」)。useAgentWorkspace が選択中のタブ・活動・送信中・
// 送信前の確認の表示中を渡し、結果を AgentTerminalPanelState.interrupt に載せる。判定の入力は描画と押した処理で同じ写像
// (toAgentInterruptAvailabilityInput)で組み立てる。押した時点の判定は checkAgentInterruptAtPress、
// タブごとの結果の待ちと 1,000ms の待ちの控えは useAgentInterruptCooldown が持つ。
// 連打の対策は組で働く(L-408): 押してから 1,000ms は押せない・同期の再入の防止(useAgentInterruptCooldown を通してこのファイル)・
// ダブルクリックの 2 回目とキーリピートの無視(AgentTerminalPanel)・押した後もフォーカスを 中断 に残す(aria-disabled。AgentTerminalPanel)。
// どれかを外すと、押し続けた Enter が 1,000ms ごとに Esc を送る、または body に落ちたフォーカスの先へ届く

/** 読み上げ(送れたとき・押せない状態で押したとき)を出しておく時間 */
export const AGENT_INTERRUPT_NOTICE_MS = 3_000

export interface AgentInterruptPanelState {
  /** 出すか(選択中のタブが starting・running) */
  visible: boolean
  /** 押せない理由。押せるなら null */
  disabledReason: string | null
  /** 送れたとき・押せない状態で押したとき(手順 2・3)の読み上げ(3,000ms で null) */
  notice: Announcement | null
  /** 押したとき。押せないときは何もしない(理由を読み上げる) */
  onInterrupt: () => void
}

/**
 * 中断に使う選択中のタブの値(AgentSessionTabView の一部)。判定に status・isClosing、slotId に活動・待ちの取り出しと送り先、
 * 読み上げに label、押した時点の画面の読み直しに controller の readScreen だけを使う
 */
export type AgentInterruptTab = Pick<
  AgentSessionTabView,
  'slotId' | 'label' | 'status' | 'isClosing'
> & {
  controller: Pick<AgentTerminalController, 'readScreen'>
}

export interface UseAgentInterruptOptions {
  /** 選択中のタブ(押した処理は押した時点の値を使う) */
  selected: AgentInterruptTab
  /** タブごとの活動(useAgentActivity の結果。描画に使った値) */
  activities: ReadonlyMap<string, AgentActivity>
  /** プロンプトを送信している間(useAgentPromptSender の isSending) */
  isSending: boolean
  /** 送信前の確認のダイアログを開いている間(useAgentSendConfirm の pending が null でない) */
  isSendConfirmOpen: boolean
  /** そのタブのセッションへ中断を送る(useAgentSessions の interrupt。拒否しない) */
  interrupt: (slotId: string) => Promise<AgentInterruptOutcome>
}

/** 押せるかの判定の入力の元になる値(描画の値、または押した時点の最新の値) */
export type AgentInterruptSources = Pick<
  UseAgentInterruptOptions,
  'selected' | 'activities' | 'isSending' | 'isSendConfirmOpen'
>

/**
 * 判定の入力を組み立てる(描画と押した処理で同じ写像を使う。L-058)。活動が未記録のタブは unknown として扱う。
 * isInterrupting は呼び出し側が渡す(描画は state の isPending、押した処理は ref の isCoolingDown)
 */
export function toAgentInterruptAvailabilityInput(
  { selected, activities, isSending, isSendConfirmOpen }: AgentInterruptSources,
  isInterrupting: boolean
): AgentInterruptAvailabilityInput {
  return {
    status: selected.status,
    isClosing: selected.isClosing,
    activity: activities.get(selected.slotId) ?? 'unknown',
    isSending,
    isSendConfirmOpen,
    isInterrupting
  }
}

export function useAgentInterrupt({
  selected,
  activities,
  isSending,
  isSendConfirmOpen,
  interrupt
}: UseAgentInterruptOptions): AgentInterruptPanelState {
  const { notice, announce } = useTransientNotice(AGENT_INTERRUPT_NOTICE_MS)
  const cooldown = useAgentInterruptCooldown()
  const { isInFlight, isCoolingDown, begin, finish } = cooldown
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const availability = getAgentInterruptAvailability(
    toAgentInterruptAvailabilityInput(
      { selected, activities, isSending, isSendConfirmOpen },
      cooldown.isPending(selected.slotId)
    )
  )
  const latestRef = useLatestRef({ selected, activities, isSending, isSendConfirmOpen, interrupt })

  const onInterrupt = useCallback((): void => {
    const current = latestRef.current
    const tab = current.selected
    const { slotId, label } = tab
    // 1. 同期の再入の防止(同じタブの結果を待つ間)。何も出さない
    if (isInFlight(slotId)) return
    // 2・3. 最新の値で押せるかを求め直し、押した時点の画面を読み直す。押せなければ理由を読み上げる(L-057)
    const check = checkAgentInterruptAtPress(
      toAgentInterruptAvailabilityInput(current, isCoolingDown(slotId)),
      () => tab.controller.readScreen()
    )
    if (check.kind === 'unreadable') {
      console.error('[useAgentInterrupt] 画面を読めないため、中断を送りません:', check.error)
      return
    }
    if (check.kind === 'blocked') {
      announce(check.reason)
      return
    }
    // 4. 送っている途中と 1,000ms の待ちを始める(待ちはタブごと)
    begin(slotId)
    void (async () => {
      try {
        // 5・6. 送れたときだけ読み上げる(L-001)。stale・skipped は何も出さず、失敗は useAgentSessions がタブの error に出す
        const outcome = await current.interrupt(slotId)
        if (outcome.kind === 'sent' && mountedRef.current) announce(agentInterruptSentNotice(label))
      } catch (err) {
        console.error('[useAgentInterrupt] 中断の送信に失敗しました:', err)
      } finally {
        // 7. 例外でも固まらない(L-053)。1,000ms の待ちはタイマーが外す(結果が 1,000ms より遅いと、届くまで押せない)
        finish(slotId)
      }
    })()
  }, [latestRef, announce, isInFlight, isCoolingDown, begin, finish])

  return {
    visible: availability.visible,
    disabledReason: availability.reason,
    notice,
    onInterrupt
  }
}
