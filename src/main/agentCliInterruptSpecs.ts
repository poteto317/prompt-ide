import type { AgentCliKind } from '@shared/agentCliKinds'

// CLI の種類ごとの中断の送り方(設計書 2026-10-21「main の送り方の表」。段階 1 の起動の表 agentCliLaunchSpecs と同じ流儀)。
// 書くバイトは固定の Esc(AGENT_INTERRUPT_SEQUENCE)で、回数・間隔・期限は main だけが決める(L-019)。renderer は 2 回目を
// 「頼む」か「頼まない」かだけを選べる。文言の表(renderer の agentInterruptMessages.ts の AGENT_INTERRUPT_KEY_TEXTS)と回数を合わせる

export interface AgentCliInterruptFollowUpSpec {
  /** 1 回目を書いてから、renderer が 2 回目を頼むまでに待つ時間(1 回目の結果で renderer に案内する) */
  afterMs: number
  /**
   * main が 2 回目を受け付ける、1 回目からの経過の下限。これより早い依頼は書かない(2 回を 1 つの読み取りに詰めて送らないための守り)。
   * afterMs より小さくし、renderer のタイマーが少し早く発火しても断らない余裕を持たせる
   */
  minIntervalMs: number
  /** 1 回目からこの時間を過ぎた依頼は書かない(CLI の 2 回の窓の内に届けるため) */
  deadlineMs: number
}

export interface AgentCliInterruptSpec {
  /** 2 回目の Esc。null なら 1 回だけ */
  followUp: AgentCliInterruptFollowUpSpec | null
}

export const AGENT_CLI_INTERRUPT_SPECS: Record<AgentCliKind, AgentCliInterruptSpec> = {
  // 作業中の Esc 1 回で中断する(2026-10-19 の設計書)
  claude: { followUp: null },
  // 2 回の窓は 500ms(`let rt=500`。80〜150ms と 450ms で効き、600ms は効かない)。100ms は利用者の決定。期限の 400ms は、
  // pty への書き込みから copilot が読むまでの遅れの余裕(100ms)を窓から引いた値。受け付けの下限の 50ms は、renderer の待ち(100ms)
  // より小さくしてタイマーの早い発火を断らないための値で、2 回を 1 つの読み取りに詰めない間隔としては十分
  copilot: { followUp: { afterMs: 100, minIntervalMs: 50, deadlineMs: 400 } }
}

/** 2 回目の依頼の時刻の判定。in-window なら書く、too-early・expired なら書かない */
export type AgentCliInterruptFollowUpTiming = 'in-window' | 'too-early' | 'expired'

/**
 * 1 回目からの経過(ms)で、2 回目を書いてよいかを決める純粋関数。minIntervalMs 未満は too-early(2 回を 1 つの読み取りに詰めない)、
 * deadlineMs を過ぎたら expired(CLI の 2 回の窓を外れる)。境界の値(ちょうど minIntervalMs・deadlineMs)は in-window
 */
export function judgeAgentCliInterruptFollowUpTiming(
  followUp: AgentCliInterruptFollowUpSpec,
  elapsedMs: number
): AgentCliInterruptFollowUpTiming {
  if (elapsedMs < followUp.minIntervalMs) return 'too-early'
  if (elapsedMs > followUp.deadlineMs) return 'expired'
  return 'in-window'
}
