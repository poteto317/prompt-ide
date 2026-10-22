import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentSendClock, AgentSendOutcome, AgentSendTarget } from './agentPromptSend'
import { sendClaudePrompt } from './claudePromptSend'
import { sendCopilotPrompt } from './copilotPromptSend'

// CLI の種類ごとの送信の手順(段階 2a の判定の表 agentScreenClassifiers.ts と同じ流儀。L-593)。本文の検査(先頭の文字)は
// shared/agentPasteText.ts の AGENT_PROMPT_TEXT_RULES、失敗の文言は agentSendMessages.ts の AGENT_SEND_FAILURE_KIND_TEXTS にある

export interface AgentPromptSendSpec {
  /**
   * 押せる条件に「画面の活動が入力待ち(idle)」と「そのタブが中断の流れの外」を入れるか。作業中の Enter を送信待ちに積む CLI
   * (claude)は false、作業中の Enter が勝手に送られる送信待ちになり、中断が Esc 2 回の CLI(copilot)は true。押せる条件は
   * promptRunAvailability.ts、押した時点の中断の守りは useAgentPromptSender が引く
   */
  requiresIdle: boolean
  /** 送信の手順。正規化(normalizeAgentPrompt(raw, kind))から Enter(と送れたことの確かめ)まで。例外は投げうる(呼び出し側が文言にする) */
  send: (
    target: AgentSendTarget,
    rawText: string,
    clock: AgentSendClock
  ) => Promise<AgentSendOutcome>
}

export const AGENT_PROMPT_SEND_SPECS: Record<AgentCliKind, AgentPromptSendSpec> = {
  claude: { requiresIdle: false, send: sendClaudePrompt },
  copilot: { requiresIdle: true, send: sendCopilotPrompt }
}
