// src/renderer/src/hooks/useAgentPermissionAnswer.ts
import { useCallback, useEffect, useRef } from 'react'
import type { Announcement } from '../types'
import type { AgentActivity } from '../lib/agentActivity'
import type { AgentTerminalController } from '../lib/agentTerminalController'
import {
  checkAgentPermissionAnswerAtPress,
  getAgentPermissionAnswerAvailability
} from '../lib/agentPermissionAnswer'
import type { AgentPermissionAnswerAvailabilityInput } from '../lib/agentPermissionAnswer'
import type { AgentPermissionChoice, AgentPermissionPrompt } from '../lib/agentPermissionPrompt'
import { agentPermissionAnswerSentNotice } from '../lib/agentPermissionAnswerMessages'
import {
  toAgentPermissionAnswerButtonState,
  toAgentPermissionAnswerQuestion
} from '../lib/agentPermissionAnswerView'
import type { AgentPermissionAnswerButtonState } from '../lib/agentPermissionAnswerView'
import type { AgentPermissionAnswerCooldown } from './useAgentPermissionAnswerCooldown'
import type { AgentPermissionAnswerAppearGrace } from './useAgentPermissionAnswerAppearGrace'
import type { AgentPermissionAnswerOutcome, AgentSessionTabView } from './useAgentSessions'
import { useLatestRef } from './useLatestRef'
import { useAgentTerminalScrolledToBottom } from './useAgentTerminalScrolledToBottom'
import { useTransientNotice } from './useTransientNotice'

// 帯の 許可・拒否 の押した処理と読み上げ(設計書 2026-11-06「押したときの処理」)。useAgentWorkspace が選択中のタブ・活動・描画の読み取り・
// 送信中・確認の表示中・パネルの開閉・中断の流れ・待ちの控え・出た直後の猶予を渡し(ターミナルのスクロールは選択中のタブの controller から
// このファイルで読む)、結果を AgentTerminalPanelState.permissionAnswer に載せる。判定の入力は描画と押した処理で
// 同じ写像(toAgentPermissionAnswerAvailabilityInput)で組み立てる(L-058)。
// 許可の確認が帯に出た(別の確認に替わった)描画から 1,000ms は押せない(出た直後の猶予。useAgentPermissionAnswerAppearGrace。挿し込みで
// 中断 のあった位置に来た 許可 への 1 回目のクリックを捨てる)。
// 連打の対策は組で働く(L-408): 押してから 1,000ms と、送った後の画面を読み直すまでは押せない(useAgentPermissionAnswerCooldown・
// useAgentPermissionPrompt)・同期の再入の防止(cooldown.isInFlight。このファイル)・ダブルクリックの 2 回目とキーリピートの無視
// (AgentPermissionAnswerButton)・押した後もフォーカスを押したボタンに残す(aria-disabled)・ボタンが消えたら開閉のボタンへ移す
// (useAgentPermissionAnswerFocus)。どれかを外すと、押し続けた Enter が次の許可の確認に答える、または移った先の 中断・終了 を押す

/** 読み上げ(送れたとき・押せない状態で押したとき)を出しておく時間 */
export const AGENT_PERMISSION_ANSWER_NOTICE_MS = 3_000

export interface AgentPermissionAnswerPanelState {
  /** 出すか(選択中のタブが running・能力あり・許可待ち) */
  visible: boolean
  /** 問いの 1 行目と全文(読み取れないなら null) */
  question: { firstLine: string; full: string } | null
  allow: AgentPermissionAnswerButtonState
  deny: AgentPermissionAnswerButtonState
  /** 送れたとき・押せない状態で押したときの読み上げ(3,000ms で null) */
  notice: Announcement | null
  /** 押したとき。押せないときは何もしない(理由を読み上げる) */
  onAnswer: (choice: AgentPermissionChoice) => void
}

/** 答えに使う選択中のタブの値(AgentSessionTabView の一部) */
export type AgentPermissionAnswerTab = Pick<
  AgentSessionTabView,
  'slotId' | 'label' | 'status' | 'isClosing' | 'cliKind'
> & {
  controller: Pick<
    AgentTerminalController,
    'readScreen' | 'isScrolledToBottom' | 'onScroll' | 'onOutputWritten' | 'onResized'
  >
}

export interface UseAgentPermissionAnswerOptions {
  /** 選択中のタブ(押した処理は押した時点の値を使う) */
  selected: AgentPermissionAnswerTab
  /** タブごとの活動(useAgentActivity の結果。描画に使った値) */
  activities: ReadonlyMap<string, AgentActivity>
  /** 判定に使う描画の読み取り(useAgentPermissionPrompt の prompt。読み直し待ちの間は null) */
  prompt: AgentPermissionPrompt | null
  /** 問いとボタンの名前に使う描画の読み取り(useAgentPermissionPrompt の displayPrompt。読み直し待ちの間も直前の値) */
  displayPrompt: AgentPermissionPrompt | null
  /** プロンプトを送信している間(useAgentPromptSender の isSending) */
  isSending: boolean
  /** 送信前の確認のダイアログを開いている間 */
  isSendConfirmOpen: boolean
  /** エージェントのパネルを開いているか(useAgentTerminalPanel の isOpen。閉じている間は 許可 を押せない。押した処理は最新の値) */
  isPanelOpen: boolean
  /** 描画用: そのタブが中断の流れの間(useAgentInterrupt の isInterruptPending。state) */
  isInterruptPending: (slotId: string) => boolean
  /** 押した時点用: そのタブが中断の流れの間(useAgentInterrupt の isInterrupting。ref) */
  isInterrupting: (slotId: string) => boolean
  /** 答えの待ち(useAgentWorkspace が先に作った useAgentPermissionAnswerCooldown) */
  cooldown: Pick<
    AgentPermissionAnswerCooldown,
    'isPending' | 'isPendingNow' | 'isInFlight' | 'begin' | 'finish'
  >
  /** 出た直後の猶予(useAgentWorkspace が作った useAgentPermissionAnswerAppearGrace。描画は state、押した処理は ref を読む) */
  appearGrace: AgentPermissionAnswerAppearGrace
  /** そのタブのセッションへ答えを送る(useAgentSessions の answerPermission。拒否しない) */
  answerPermission: (slotId: string, optionNumber: number) => Promise<AgentPermissionAnswerOutcome>
}

/** 押せるかの判定の入力の元になる値(描画の値、または押した時点の最新の値) */
export type AgentPermissionAnswerSources = Pick<
  UseAgentPermissionAnswerOptions,
  'selected' | 'activities' | 'prompt' | 'isSending' | 'isSendConfirmOpen' | 'isPanelOpen'
>

/**
 * 判定の入力を組み立てる(描画と押した処理で同じ写像。L-058)。活動が未記録のタブは unknown。中断の流れ・答えた直後・確認が出た直後・
 * ターミナルのスクロールは呼び出し側が渡す(描画は state の isInterruptPending・cooldown.isPending・appearGrace.isJustAppeared・
 * useAgentTerminalScrolledToBottom、押した処理は ref の isInterrupting・cooldown.isPendingNow・appearGrace.isJustAppearedNow と
 * controller.isScrolledToBottom() を直接読んだ値)
 */
export function toAgentPermissionAnswerAvailabilityInput(
  {
    selected,
    activities,
    prompt,
    isSending,
    isSendConfirmOpen,
    isPanelOpen
  }: AgentPermissionAnswerSources,
  {
    isInterrupting,
    isAnswering,
    isJustAppeared,
    isScrolledToBottom
  }: {
    isInterrupting: boolean
    isAnswering: boolean
    isJustAppeared: boolean
    isScrolledToBottom: boolean
  }
): AgentPermissionAnswerAvailabilityInput {
  return {
    status: selected.status,
    cliKind: selected.cliKind,
    isClosing: selected.isClosing,
    activity: activities.get(selected.slotId) ?? 'unknown',
    isSending,
    isSendConfirmOpen,
    isInterrupting,
    isAnswering,
    isJustAppeared,
    isPanelOpen,
    isScrolledToBottom,
    prompt
  }
}

export function useAgentPermissionAnswer(
  options: UseAgentPermissionAnswerOptions
): AgentPermissionAnswerPanelState {
  const { selected, displayPrompt, isInterruptPending, cooldown, appearGrace } = options
  const { notice, announce } = useTransientNotice(AGENT_PERMISSION_ANSWER_NOTICE_MS)
  const mountedRef = useRef(false)
  const isScrolledToBottom = useAgentTerminalScrolledToBottom(selected.controller)

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  const renderInput = toAgentPermissionAnswerAvailabilityInput(options, {
    isInterrupting: isInterruptPending(selected.slotId),
    isAnswering: cooldown.isPending(selected.slotId),
    isJustAppeared: appearGrace.isJustAppeared,
    isScrolledToBottom
  })
  const allow = getAgentPermissionAnswerAvailability(renderInput, 'allow')
  const deny = getAgentPermissionAnswerAvailability(renderInput, 'deny')
  const latestRef = useLatestRef(options)

  const onAnswer = useCallback(
    (choice: AgentPermissionChoice): void => {
      const current = latestRef.current
      // 押した時点のタブ(結果が届くまでに別のタブを選んでも、このタブへ送ってこのタブで読み上げる)
      const tab = current.selected
      const { slotId, label, cliKind } = tab
      const { cooldown: currentCooldown } = current
      // 1. 同期の再入の防止(同じタブの結果を待つ間)。何も出さない(L-101・L-653)
      if (currentCooldown.isInFlight(slotId)) return
      // 2. 最新の値で可否を求め直し、押した時点の画面を読み直して照合する(段階 (a)〜(f))。押せなければ理由を読み上げる(L-057)
      const check = checkAgentPermissionAnswerAtPress(
        toAgentPermissionAnswerAvailabilityInput(current, {
          isInterrupting: current.isInterrupting(slotId),
          isAnswering: currentCooldown.isPendingNow(slotId),
          isJustAppeared: current.appearGrace.isJustAppearedNow(),
          // 押した時点の値(描画の値は onScroll の通知の後の再描画までずれうる)
          isScrolledToBottom: tab.controller.isScrolledToBottom()
        }),
        choice,
        () => tab.controller.readScreen()
      )
      if (check.kind === 'unreadable') {
        console.error(
          '[useAgentPermissionAnswer] 画面を読めないため、答えを送りません:',
          check.error
        )
        return
      }
      if (check.kind === 'blocked') {
        announce(check.reason)
        return
      }
      // 3. 送っている途中・1,000ms の待ち・読み直し待ちを同時に始める
      currentCooldown.begin(slotId)
      const { optionNumber } = check
      void (async () => {
        try {
          // 4・5. 送る番号は押した時点の判定の結果だけ(L-594)。送れたときだけ読み上げる(L-001)
          const outcome = await current.answerPermission(slotId, optionNumber)
          if (outcome.kind === 'sent' && mountedRef.current) {
            announce(agentPermissionAnswerSentNotice(label, cliKind, choice, optionNumber))
          }
        } catch (err) {
          console.error('[useAgentPermissionAnswer] 答えの送信に失敗しました:', err)
        } finally {
          // 6. 送っている途中だけを解く(例外でも固まらない。L-053)。1,000ms と読み直し待ちは別に外れる
          currentCooldown.finish(slotId)
        }
      })()
    },
    [latestRef, announce]
  )

  // 表示の値(問い・ボタンの名前と押せない理由)の組み立ては agentPermissionAnswerView.ts。押せない理由は判定用の prompt から、問いと名前は
  // 表示用の displayPrompt から作る(読み直し待ちの間も名前と問いを変えない)
  return {
    visible: allow.visible,
    question: toAgentPermissionAnswerQuestion(displayPrompt),
    allow: toAgentPermissionAnswerButtonState('allow', selected.label, displayPrompt, allow),
    deny: toAgentPermissionAnswerButtonState('deny', selected.label, displayPrompt, deny),
    notice,
    onAnswer
  }
}
