// src/renderer/src/lib/agentPermissionAnswerView.ts
import type { AgentPermissionAnswerAvailability } from './agentPermissionAnswer'
import type { AgentPermissionChoice, AgentPermissionPrompt } from './agentPermissionPrompt'
import { findAgentPermissionOption } from './agentPermissionPrompt'
import { agentPermissionAnswerAriaLabel } from './agentPermissionAnswerMessages'

// 帯の 許可・拒否 の表示に使う値(問いの 1 行目と全文・ボタンの押せない理由と名前)を、描画の読み取りと押せるかの判定から作る
// (設計書 2026-11-06「画面」)。押した処理(useAgentPermissionAnswer)とは分け、表示の組み立てだけをここに置く

export interface AgentPermissionAnswerButtonState {
  /** 押せない理由。押せるなら null */
  disabledReason: string | null
  ariaLabel: string
}

/**
 * 帯に出す問い(1 行目と、行を半角空白でつないだ全文)。読み取れないなら null。見える 1 行目は aria-hidden で、読み上げはボタンの名前に
 * 入れた問いが担う。問いが折り返すと 2 行目に対象のファイル名が来るため、ボタンの名前(toAgentPermissionAnswerButtonState)には
 * 1 行目ではなく全文(full)を使う(1 行目だけだと支援技術にどのファイルかが伝わらない。見える表示だけが 1 行目の省略)
 */
export function toAgentPermissionAnswerQuestion(
  prompt: AgentPermissionPrompt | null
): { firstLine: string; full: string } | null {
  if (prompt === null) return null
  return { firstLine: prompt.question[0], full: prompt.question.join(' ') }
}

/**
 * ボタン 1 つ分の表示。名前の番号は描画の読み取りから引く(押せない理由があるときも名前を変えない)。送る番号には使わない
 * (送る番号は押した時点の判定の結果だけ。L-594)
 */
export function toAgentPermissionAnswerButtonState(
  choice: AgentPermissionChoice,
  tabLabel: string,
  prompt: AgentPermissionPrompt | null,
  availability: Pick<AgentPermissionAnswerAvailability, 'reason'>
): AgentPermissionAnswerButtonState {
  return {
    disabledReason: availability.reason,
    ariaLabel: agentPermissionAnswerAriaLabel(
      choice,
      tabLabel,
      toAgentPermissionAnswerQuestion(prompt)?.full ?? null,
      prompt === null ? null : (findAgentPermissionOption(prompt, choice)?.number ?? null)
    )
  }
}
