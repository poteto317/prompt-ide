import { AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import { classifyAgentScreenFor } from './agentScreenClassifiers'
import type { AgentActivity } from './agentActivity'
import { isActiveAgentSessionStatus } from './agentSessionTabState'
import type { AgentSessionStatus } from './agentSessionTabState'
import type { ViewportLine } from './agentViewport'
import {
  AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION,
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  agentInterruptBlockedByActivityReason,
  agentInterruptNotRunningReason,
  agentInterruptUnsupportedReason
} from './agentInterruptMessages'

// 帯の 中断 を押せるかの判定(設計書 2026-10-19「押せるかの判定」)。描画(useAgentInterrupt の disabledReason)と、押した処理の
// 先頭の判定(checkAgentInterruptAtPress の手順 2。L-058)で同じ関数を使う。押した時点の画面の読み直し(手順 3)と、2 回目の要る種類の
// 2 回目の前の画面の読み直し(checkAgentInterruptFollowUp。設計書 2026-10-21「中断の流れ」の手順 7)もここで決める

/**
 * 押してから押せない間。入力待ちの画面で 2 回目の Esc は 0.5 秒後なら入力欄を消し、0.9 秒以上空けると消さなかった
 * (MVP の確認の結果 17)ため、0.9 秒より長くする。copilot は 500ms 以内の Esc 2 回を中断・書きかけの消去・巻き戻しとして扱うため、
 * 2 回目の流れが終わった時点からこの待ちを数え直し(useAgentInterruptCooldown の restartCooldown)、次の 1 回目を前の 2 回目から
 * 常に 1,000ms 以上空ける(設計書 2026-10-21「中断の待ち」)
 */
export const AGENT_INTERRUPT_COOLDOWN_MS = 1_000

export interface AgentInterruptAvailabilityInput {
  status: AgentSessionStatus
  /** 対象のタブ(選択中のタブ)の CLI の種類。能力の表で中断に対応しない種類は押せず、許可待ち・判定できないの理由の文言も種類で変わる */
  cliKind: AgentCliKind
  isClosing: boolean
  activity: AgentActivity
  isSending: boolean
  isSendConfirmOpen: boolean
  /**
   * 対象のタブ(選択中のタブ)が、送っている途中か、押してから AGENT_INTERRUPT_COOLDOWN_MS 以内(2 回目の要る種類は 2 回目の流れが
   * 終わってから数え直す。待ちはタブごと)
   */
  isInterrupting: boolean
  /**
   * 対象のタブが、許可の答えを送っている途中か、押してから 1,000ms 以内か、送った後の画面の読み直し待ち(useAgentPermissionAnswerCooldown の
   * isPending / isPendingNow)。答えた直後は、CLI が数字を受け取って描き直すまでの画面と許可して作業中になった画面のどちらも読みうるうえ、
   * 続けて許可の確認が出ると Esc は拒否・取り消しになるため
   */
  isAnsweringPermission: boolean
}

export interface AgentInterruptAvailability {
  /** ボタンを出すか(starting・running) */
  visible: boolean
  /** 押せない理由。押せるなら null */
  reason: string | null
}

/** 活動が working でないときの理由(押した時点の画面の読み直し〈手順 3〉でも使う)。許可待ち・判定できないの文言はタブの種類で変わる */
export function describeAgentInterruptBlockedByActivity(
  activity: Exclude<AgentActivity, 'working'>,
  cliKind: AgentCliKind
): string {
  return agentInterruptBlockedByActivityReason(activity, cliKind)
}

/** 表の順(起動中 → CLI が中断に対応していない → 閉じる途中 → 送信中 → 確認の表示中 → 送っている途中・1,000ms 以内 → 許可の答えを押した直後(送っている途中・1,000ms・読み直し待ち) → 活動)で最初に当たった理由 */
function blockedReasonOf(input: AgentInterruptAvailabilityInput): string | null {
  if (input.status === 'starting') return AGENT_INTERRUPT_DISABLED_STARTING
  // CLI に中断の能力が無い(能力の表の interrupt が false の種類。段階 2a で claude・copilot とも中断できる)。起動中の直後・閉じる途中より前
  // (設計書「入口ごとの表」)。main では拒否しない
  if (!agentCliCapabilities(input.cliKind).interrupt) {
    return agentInterruptUnsupportedReason(AGENT_CLI_PROFILES[input.cliKind].commandName)
  }
  if (input.isClosing) return AGENT_INTERRUPT_DISABLED_CLOSING
  if (input.isSending) return AGENT_INTERRUPT_DISABLED_SENDING
  if (input.isSendConfirmOpen) return AGENT_INTERRUPT_DISABLED_SEND_CONFIRM
  if (input.isInterrupting) return AGENT_INTERRUPT_DISABLED_COOLDOWN
  if (input.isAnsweringPermission) return AGENT_INTERRUPT_DISABLED_ANSWERING_PERMISSION
  if (input.activity !== 'working')
    return describeAgentInterruptBlockedByActivity(input.activity, input.cliKind)
  return null
}

export function getAgentInterruptAvailability(
  input: AgentInterruptAvailabilityInput
): AgentInterruptAvailability {
  // 動いていない(未起動・終了の)帯には出さない(起動・前回の続きから の並びと狭い幅の扱いを変えない)。帯が 終了 を出すかと
  // 同じ判定(isActiveAgentSessionStatus)を使い、中断 を 終了 の直前に出す条件を 1 か所にまとめる
  if (!isActiveAgentSessionStatus(input.status)) {
    return {
      visible: false,
      reason: agentInterruptNotRunningReason(AGENT_CLI_PROFILES[input.cliKind].commandName)
    }
  }
  return { visible: true, reason: blockedReasonOf(input) }
}

/** 押した時点の判定の結果(useAgentInterrupt の手順 2・3) */
export type AgentInterruptPressCheck =
  | { kind: 'send' }
  /** 押せない(理由を読み上げる) */
  | { kind: 'blocked'; reason: string }
  /** 画面を読めない(送らず、読み上げもしない。呼び出し側が console に記録する) */
  | { kind: 'unreadable'; error: unknown }

/**
 * 押した時点の値で送ってよいかを決める。まず描画と同じ規則で押せるかを求め直し(手順 2。ボタンの見た目が古くても送らない。
 * L-058)、次に押した時点の画面を読み直す(手順 3。活動の判定は出力が 150ms 静まってから〈最大 500ms 遅れて〉行うため、
 * 作業中から許可の確認へ変わった直後に古い working のまま押されて、許可を拒否するのを防ぐ)。画面は手順 2 を通ったときだけ読む
 */
export function checkAgentInterruptAtPress(
  input: AgentInterruptAvailabilityInput,
  readScreen: () => readonly ViewportLine[]
): AgentInterruptPressCheck {
  const { reason } = getAgentInterruptAvailability(input)
  if (reason !== null) return { kind: 'blocked', reason }
  let screenActivity: AgentActivity
  try {
    // タブの種類の規則で読む(copilot の画面を claude の規則で読んで作業中と取り違えない)
    screenActivity = classifyAgentScreenFor(input.cliKind, readScreen())
  } catch (error) {
    return { kind: 'unreadable', error }
  }
  if (screenActivity !== 'working') {
    return {
      kind: 'blocked',
      reason: describeAgentInterruptBlockedByActivity(screenActivity, input.cliKind)
    }
  }
  return { kind: 'send' }
}

/** 2 回目の前の確かめの結果(useAgentInterrupt の手順 7) */
export type AgentInterruptFollowUpCheck =
  | { kind: 'send' }
  /** 作業中でなくなった・判定できない(2 回目を頼まず、活動に応じて読み上げる) */
  | { kind: 'skip'; activity: Exclude<AgentActivity, 'working'> }
  /** 画面を読めない(2 回目を頼まず、読み上げもしない。呼び出し側が console に記録する) */
  | { kind: 'unreadable'; error: unknown }

/**
 * 2 回目の Esc を頼む直前に、送った先のタブの画面をタブの種類の規則で読み直す。作業中のときだけ send(入力待ちの copilot に 2 回目が
 * 届くと、1 回目と組になって書きかけの消去・巻き戻しの画面になるため。L-041)。送信中・確認の表示中・閉じる途中は見直さない
 * (送信中は 1 回目を押せず、中断の流れの間は送信を始めない〈useAgentPromptSender と押せる条件の requiresIdle〉ので、2 回目を待つ間に
 * 送信が始まることはない。閉じる途中は useAgentSessions の interruptFollowUp が stale で止める)
 */
export function checkAgentInterruptFollowUp(
  cliKind: AgentCliKind,
  readScreen: () => readonly ViewportLine[]
): AgentInterruptFollowUpCheck {
  let activity: AgentActivity
  try {
    activity = classifyAgentScreenFor(cliKind, readScreen())
  } catch (error) {
    return { kind: 'unreadable', error }
  }
  return activity === 'working' ? { kind: 'send' } : { kind: 'skip', activity }
}
