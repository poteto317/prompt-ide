import { useCallback, useEffect, useRef } from 'react'
import type { Announcement } from '../types'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import {
  checkAgentInterruptAtPress,
  checkAgentInterruptFollowUp,
  getAgentInterruptAvailability
} from '../lib/agentInterrupt'
import type { AgentInterruptAvailabilityInput } from '../lib/agentInterrupt'
import {
  agentInterruptFollowUpSkippedNotice,
  agentInterruptSentNotice
} from '../lib/agentInterruptMessages'
import type {
  AgentInterruptFollowUpOutcome,
  AgentInterruptOutcome,
  AgentSessionTabView
} from './useAgentSessions'
import { useAgentInterruptCooldown } from './useAgentInterruptCooldown'
import { useAgentInterruptFollowUpWait } from './useAgentInterruptFollowUpWait'
import { useLatestRef } from './useLatestRef'
import { useTransientNotice } from './useTransientNotice'

// 帯の 中断 の押した処理と読み上げ(設計書 2026-10-19「押したときの処理」、2026-10-21「中断の流れ」の手順 5〜9)。useAgentWorkspace が選択中のタブ・活動・送信中・
// 送信前の確認の表示中を渡し、結果を AgentTerminalPanelState.interrupt に載せる。判定の入力は描画と押した処理で同じ写像
// (toAgentInterruptAvailabilityInput)で組み立てる。押した時点の判定は checkAgentInterruptAtPress、
// タブごとの結果の待ちと 1,000ms の待ちの控えは useAgentInterruptCooldown、2 回目を頼むまでの待ちは useAgentInterruptFollowUpWait が持つ。
// 連打の対策は組で働く(L-408): 押してから 1,000ms は押せない・同期の再入の防止(useAgentInterruptCooldown を通してこのファイル)・
// ダブルクリックの 2 回目とキーリピートの無視(AgentTerminalPanel)・押した後もフォーカスを 中断 に残す(aria-disabled。AgentTerminalPanel)。
// どれかを外すと、押し続けた Enter が 1,000ms ごとに Esc を送る、または body に落ちたフォーカスの先へ届く
// 2 回目の要る種類(copilot)は、1 回目の結果の案内の時間だけ待ち、送った先のタブの画面が作業中のときだけ 2 回目を頼み、
// 2 回目の流れが終わった時点で 1,000ms の待ちを数え直す(次の 1 回目を前の 2 回目から常に 1,000ms 以上空ける)

/** 読み上げ(送れたとき・押せない状態で押したとき・2 回目を頼まなかったとき)を出しておく時間 */
export const AGENT_INTERRUPT_NOTICE_MS = 3_000

export interface AgentInterruptPanelState {
  /** 出すか(選択中のタブが starting・running) */
  visible: boolean
  /** 押せない理由。押せるなら null */
  disabledReason: string | null
  /** 送れたとき・押せない状態で押したとき(手順 2・3)・2 回目を頼まなかったとき(手順 7)の読み上げ(3,000ms で null) */
  notice: Announcement | null
  /** 押したとき。押せないときは何もしない(理由を読み上げる) */
  onInterrupt: () => void
}

/**
 * useAgentInterrupt の戻り値。パネル(AgentTerminalPanel)へは AgentInterruptPanelState の値だけを渡し、送信の判定に使う 2 つは
 * useAgentWorkspace が使う(設計書 2026-10-22「中断との排他」)
 */
export interface AgentInterruptState extends AgentInterruptPanelState {
  /** 押した時点用: そのタブが中断の流れの間(1 回目を送ってから 2 回目の流れが終わり、1,000ms の待ちが明けるまで)。ref で常に最新。参照は安定 */
  isInterrupting: (slotId: string) => boolean
  /** 描画用: isInterrupting と同じ間(state)。実行・再実行・送信前の確認の押せない理由に使う */
  isInterruptPending: (slotId: string) => boolean
}

/**
 * 中断に使う選択中のタブの値(AgentSessionTabView の一部)。判定に status・cliKind・isClosing、slotId に活動・待ちの取り出しと送り先、
 * 読み上げに label・cliKind、押した時点と 2 回目の前の画面の読み直しに controller の readScreen(規則は cliKind で引く)だけを使う
 */
export type AgentInterruptTab = Pick<
  AgentSessionTabView,
  'slotId' | 'label' | 'status' | 'isClosing' | 'cliKind'
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
  /** 1 回目を送ったセッションへ中断の 2 回目を頼む(useAgentSessions の interruptFollowUp。拒否しない。省略できない。L-060) */
  interruptFollowUp: (slotId: string, sessionId: string) => Promise<AgentInterruptFollowUpOutcome>
  /** そのタブがまだあるか(useAgentSessions の tabs にあるか)。2 回目を待つ間に閉じたタブの、破棄した画面を読まないため。省略できない */
  isTabOpen: (slotId: string) => boolean
  /** 描画用: そのタブが許可の答えを押した直後(送っている途中・1,000ms・読み直し待ち)か(useAgentPermissionAnswerCooldown の isPending。state)。省略できない(L-060) */
  isAnsweringPermission: (slotId: string) => boolean
  /** 押した時点用: isAnsweringPermission と同じ間(useAgentPermissionAnswerCooldown の isPendingNow。ref)。省略できない */
  isAnsweringPermissionNow: (slotId: string) => boolean
}

/** 押せるかの判定の入力の元になる値(描画の値、または押した時点の最新の値) */
export type AgentInterruptSources = Pick<
  UseAgentInterruptOptions,
  'selected' | 'activities' | 'isSending' | 'isSendConfirmOpen'
>

/**
 * 判定の入力を組み立てる(描画と押した処理で同じ写像を使う。L-058)。活動が未記録のタブは unknown として扱う。
 * isInterrupting・isAnsweringPermission は呼び出し側が渡す(描画は state の isPending・isAnsweringPermission、押した処理は ref の
 * isCoolingDown・isAnsweringPermissionNow)
 */
export function toAgentInterruptAvailabilityInput(
  { selected, activities, isSending, isSendConfirmOpen }: AgentInterruptSources,
  isInterrupting: boolean,
  isAnsweringPermission: boolean
): AgentInterruptAvailabilityInput {
  return {
    status: selected.status,
    cliKind: selected.cliKind,
    isClosing: selected.isClosing,
    activity: activities.get(selected.slotId) ?? 'unknown',
    isSending,
    isSendConfirmOpen,
    isInterrupting,
    isAnsweringPermission
  }
}

export function useAgentInterrupt({
  selected,
  activities,
  isSending,
  isSendConfirmOpen,
  interrupt,
  interruptFollowUp,
  isTabOpen,
  isAnsweringPermission,
  isAnsweringPermissionNow
}: UseAgentInterruptOptions): AgentInterruptState {
  const { notice, announce } = useTransientNotice(AGENT_INTERRUPT_NOTICE_MS)
  const cooldown = useAgentInterruptCooldown()
  const { isInFlight, isCoolingDown, begin, finish, restartCooldown } = cooldown
  // 2 回目を頼むまでの待ち。アンマウントで消し、待っている流れには 2 回目を頼ませない
  const waitForFollowUp = useAgentInterruptFollowUpWait()
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
      cooldown.isPending(selected.slotId),
      isAnsweringPermission(selected.slotId)
    )
  )
  const latestRef = useLatestRef({
    selected,
    activities,
    isSending,
    isSendConfirmOpen,
    interrupt,
    interruptFollowUp,
    isTabOpen,
    isAnsweringPermissionNow
  })

  const onInterrupt = useCallback((): void => {
    const current = latestRef.current
    // 押した時点のタブ。2 回目の前の確かめも、待つ間に別のタブを選んでもこのタブ(送った先)で行う
    const tab = current.selected
    const { slotId, label, cliKind } = tab
    // 1. 同期の再入の防止(同じタブの結果を待つ間。2 回目まで続く)。何も出さない
    if (isInFlight(slotId)) return
    // 2・3. 最新の値で押せるかを求め直し、押した時点の画面をタブの種類の規則で読み直す。押せなければ理由を読み上げる(L-057)
    const check = checkAgentInterruptAtPress(
      toAgentInterruptAvailabilityInput(
        current,
        isCoolingDown(slotId),
        current.isAnsweringPermissionNow(slotId)
      ),
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
      // 2 回目を頼む案内があり、案内の時間を待ち終えた流れか(手順 8 で 1,000ms の待ちを数え直す)
      let followUpFlow = false
      try {
        // 5. 1 回目。stale・skipped は何も出さず、失敗は useAgentSessions がタブの error に出す
        const outcome = await current.interrupt(slotId)
        if (outcome.kind !== 'sent') return
        const { followUp } = outcome
        if (followUp === null) {
          // 2 回目の無い種類(claude)は、送れたときだけ読み上げる(L-001)
          if (mountedRef.current) announce(agentInterruptSentNotice(label, cliKind))
          return
        }
        // 6. 2 回目の要る種類(copilot)。main の案内の時間だけ待つ(アンマウントで消したら頼まない)
        if (!(await waitForFollowUp(followUp.afterMs))) return
        followUpFlow = true
        // 待つ間に送った先のタブを閉じたら、何もせず終える(破棄した画面は読めない。セッションも無いので 2 回目は届かない)
        if (!latestRef.current.isTabOpen(slotId)) return
        // 7. 送った先のタブの画面を、そのタブの種類の規則で読み直す。作業中のときだけ 2 回目を頼む(L-041)
        const followUpCheck = checkAgentInterruptFollowUp(cliKind, () =>
          tab.controller.readScreen()
        )
        if (followUpCheck.kind === 'unreadable') {
          console.error(
            '[useAgentInterrupt] 画面を読めないため、中断の 2 回目を送りません:',
            followUpCheck.error
          )
          return
        }
        if (followUpCheck.kind === 'skip') {
          if (mountedRef.current) {
            announce(agentInterruptFollowUpSkippedNotice(label, followUpCheck.activity))
          }
          return
        }
        const followUpOutcome = await current.interruptFollowUp(slotId, followUp.sessionId)
        // 2 回目まで送れたときだけ「中断を送りました」と読み上げる(L-001)。stale は何も出さず、失敗は useAgentSessions が出す
        if (followUpOutcome.kind === 'sent' && mountedRef.current) {
          announce(agentInterruptSentNotice(label, cliKind))
        }
      } catch (err) {
        console.error('[useAgentInterrupt] 中断の送信に失敗しました:', err)
      } finally {
        // 8. 2 回目の流れが終わった時点から 1,000ms の待ちを数え直す(copilot の 500ms の窓で前の Esc と組にしない)。
        // アンマウントの後は数え直さない
        if (followUpFlow && mountedRef.current) restartCooldown(slotId)
        // 9. 2 回目まで終わってから解く(例外でも固まらない。L-053)
        finish(slotId)
      }
    })()
  }, [
    latestRef,
    announce,
    isInFlight,
    isCoolingDown,
    begin,
    finish,
    restartCooldown,
    waitForFollowUp
  ])

  return {
    visible: availability.visible,
    disabledReason: availability.reason,
    notice,
    onInterrupt,
    // 送信の押した時点の判定用(useAgentPromptSender)と描画用(押せない理由)。同じ間を useAgentInterruptCooldown が両方の形で持つ
    isInterrupting: cooldown.isPendingNow,
    isInterruptPending: cooldown.isPending
  }
}
