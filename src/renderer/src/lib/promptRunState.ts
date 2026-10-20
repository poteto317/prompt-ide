import type { AgentCliKind } from '@shared/agentCliKinds'
import type { PromptExecutionMode } from '@shared/types'
import type { Announcement, PromptRunPanelState } from '../types'
import type { AgentSessionStatus } from './agentSessionTabState'
import {
  PROMPT_RUN_ARIA_LABEL_AGENT,
  PROMPT_RUN_ARIA_LABEL_LEGACY,
  getPromptRunAvailability
} from './agentSendMessages'

// 実行ボタンの押せる条件・理由・aria-label・送信の結果の組み立て(useAgentWorkspace が使う)。押せる条件の規則と
// 文言は agentSendMessages.ts にあり、ここは実行方式に応じてそれらを選んで 1 つの状態にまとめる

export interface PromptRunStateInput {
  /** 実行方式(読み込み中は null) */
  mode: PromptExecutionMode | null
  /** 従来の方式で実行しているか */
  isExecuting: boolean
  /** 能力の判定に使う CLI の種類(agentCapabilityCliKindOf。動いているタブはタブの種類、それ以外は次に起動する設定の種類) */
  cliKind: AgentCliKind
  sessionStatus: AgentSessionStatus
  /** 送り先のタブが閉じる途中か */
  isSessionClosing: boolean
  /** エージェントへ送信しているか */
  isSending: boolean
  sendError: string | null
  sendNotice: Announcement | null
}

export function buildPromptRunPanelState({
  mode,
  isExecuting,
  cliKind,
  sessionStatus,
  isSessionClosing,
  isSending,
  sendError,
  sendNotice
}: PromptRunStateInput): PromptRunPanelState {
  const isAgentMode = mode === 'agent-cli'
  const run = getPromptRunAvailability({
    mode,
    isExecuting,
    cliKind,
    isSessionRunning: sessionStatus === 'running',
    isSessionClosing,
    isSending
  })
  return {
    isRunDisabled: run.disabled,
    runDisabledReason: run.reason,
    agentSend: isAgentMode ? { error: sendError, notice: sendNotice } : null,
    showToolSelector: !isAgentMode,
    runAriaLabel: isAgentMode ? PROMPT_RUN_ARIA_LABEL_AGENT : PROMPT_RUN_ARIA_LABEL_LEGACY
  }
}
