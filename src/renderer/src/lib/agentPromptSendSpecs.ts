import type { AgentCliKind } from '@shared/agentCliKinds'
import type {
  AgentSendClock,
  AgentSendFailure,
  AgentSendOutcome,
  AgentSendTarget
} from './agentPromptSend'
import { sendClaudePrompt } from './claudePromptSend'
import { sendCopilotPrompt } from './copilotPromptSend'

// CLI の種類ごとの送信の手順(段階 2a の判定の表 agentScreenClassifiers.ts と同じ流儀。L-593)。本文の検査(先頭の文字)は
// shared/agentPasteText.ts の AGENT_PROMPT_TEXT_RULES、失敗の文言は agentSendMessages.ts の AGENT_SEND_FAILURE_KIND_TEXTS にある

export interface AgentPromptSendSpec {
  /**
   * 入力待ちを求めるか。true の種類(copilot)は、作業中・判定できない間と中断の流れの間も押せない(作業中の Enter が勝手に送られる
   * 送信待ちになり、中断が Esc 2 回のため)。false の種類(claude)は作業中の Enter を送信待ちに積むので作業中も押せる。
   * 利用者の操作を待っている活動(許可待ち・確認待ち)は、この値に依らずどの種類でも押せない(設計書 2026-11-07)。
   * 押せる条件は promptRunAvailability.ts、押した時点の中断の守りは useAgentPromptSender が引く
   */
  requiresIdle: boolean
  /** 送信の手順。正規化(normalizeAgentPrompt(raw, kind))から Enter(と送れたことの確かめ)まで。例外は投げうる(呼び出し側が文言にする) */
  send: (
    target: AgentSendTarget,
    rawText: string,
    clock: AgentSendClock
  ) => Promise<AgentSendOutcome>
  /**
   * 失敗したときに、送信の手順の間に溜めた利用者のキー入力を流さずに捨てる理由。貼り付けの後に Enter を送らなかった・送れたか
   * 確かめられなかった失敗で、溜めた Enter が入力欄に残った本文を送る・シェルで実行するのを防ぐ。claude は許可待ち・確認待ちで止めたとき
   * (screen-permission・screen-confirm)だけ捨てる(溜めた打鍵が選択の画面への答えにならないように。設計書 2026-11-07)。ほかの失敗は
   * 今のまま流す(同じ経路が残ることは ROADMAP の既知の制約)。捨てたときは useAgentPromptSender が失敗の文言に添える
   */
  discardHeldInputOn: ReadonlySet<AgentSendFailure>
}

export const AGENT_PROMPT_SEND_SPECS: Record<AgentCliKind, AgentPromptSendSpec> = {
  claude: {
    requiresIdle: false,
    send: sendClaudePrompt,
    discardHeldInputOn: new Set(['screen-permission', 'screen-confirm'])
  },
  copilot: {
    requiresIdle: true,
    send: sendCopilotPrompt,
    discardHeldInputOn: new Set(['not-echoed', 'shell-mode-after-paste', 'not-confirmed'])
  }
}
