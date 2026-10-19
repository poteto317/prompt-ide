import { classifyAgentScreen } from './agentActivity'
import type { AgentActivity } from './agentActivity'
import { isActiveAgentSessionStatus } from './agentSessionTabState'
import type { AgentSessionStatus } from './agentSessionTabState'
import type { ViewportLine } from './agentViewport'
import {
  AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY,
  AGENT_INTERRUPT_DISABLED_CLOSING,
  AGENT_INTERRUPT_DISABLED_COOLDOWN,
  AGENT_INTERRUPT_DISABLED_SEND_CONFIRM,
  AGENT_INTERRUPT_DISABLED_SENDING,
  AGENT_INTERRUPT_DISABLED_STARTING,
  AGENT_INTERRUPT_NOT_RUNNING
} from './agentInterruptMessages'

// 帯の 中断 を押せるかの判定(設計書 2026-10-19「押せるかの判定」)。描画(useAgentInterrupt の disabledReason)と、押した処理の
// 先頭の判定(checkAgentInterruptAtPress の手順 2。L-058)で同じ関数を使う。押した時点の画面の読み直し(手順 3)もここで決める

/**
 * 押してから押せない間。入力待ちの画面で 2 回目の Esc は 0.5 秒後なら入力欄を消し、0.9 秒以上空けると消さなかった
 * (MVP の確認の結果 17)ため、0.9 秒より長くする
 */
export const AGENT_INTERRUPT_COOLDOWN_MS = 1_000

export interface AgentInterruptAvailabilityInput {
  status: AgentSessionStatus
  isClosing: boolean
  activity: AgentActivity
  isSending: boolean
  isSendConfirmOpen: boolean
  /** 対象のタブ(選択中のタブ)が、送っている途中か、押してから AGENT_INTERRUPT_COOLDOWN_MS 以内(待ちはタブごと) */
  isInterrupting: boolean
}

export interface AgentInterruptAvailability {
  /** ボタンを出すか(starting・running) */
  visible: boolean
  /** 押せない理由。押せるなら null */
  reason: string | null
}

/** 活動が working でないときの理由(押した時点の画面の読み直し〈手順 3〉でも使う) */
export function describeAgentInterruptBlockedByActivity(
  activity: Exclude<AgentActivity, 'working'>
): string {
  return AGENT_INTERRUPT_BLOCKED_BY_ACTIVITY[activity]
}

/** 表の順(起動中 → 閉じる途中 → 送信中 → 確認の表示中 → 送っている途中・1,000ms 以内 → 活動)で最初に当たった理由 */
function blockedReasonOf(input: AgentInterruptAvailabilityInput): string | null {
  if (input.status === 'starting') return AGENT_INTERRUPT_DISABLED_STARTING
  if (input.isClosing) return AGENT_INTERRUPT_DISABLED_CLOSING
  if (input.isSending) return AGENT_INTERRUPT_DISABLED_SENDING
  if (input.isSendConfirmOpen) return AGENT_INTERRUPT_DISABLED_SEND_CONFIRM
  if (input.isInterrupting) return AGENT_INTERRUPT_DISABLED_COOLDOWN
  if (input.activity !== 'working') return describeAgentInterruptBlockedByActivity(input.activity)
  return null
}

export function getAgentInterruptAvailability(
  input: AgentInterruptAvailabilityInput
): AgentInterruptAvailability {
  // 動いていない(未起動・終了の)帯には出さない(起動・前回の続きから の並びと狭い幅の扱いを変えない)。帯が 終了 を出すかと
  // 同じ判定(isActiveAgentSessionStatus)を使い、中断 を 終了 の直前に出す条件を 1 か所にまとめる
  if (!isActiveAgentSessionStatus(input.status)) {
    return { visible: false, reason: AGENT_INTERRUPT_NOT_RUNNING }
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
    screenActivity = classifyAgentScreen(readScreen())
  } catch (error) {
    return { kind: 'unreadable', error }
  }
  if (screenActivity !== 'working') {
    return { kind: 'blocked', reason: describeAgentInterruptBlockedByActivity(screenActivity) }
  }
  return { kind: 'send' }
}
