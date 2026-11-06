import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentPermissionPrompt, AgentPermissionPromptReader } from './agentPermissionPrompt'
import { classifyAgentScreenFor } from './agentScreenClassifiers'
import type { ViewportLine } from './agentViewport'
import { readClaudePermissionPrompt } from './claudePermissionPrompt'
import { readCopilotPermissionPrompt } from './copilotPermissionPrompt'

// CLI の種類ごとの許可の確認の読み取りの表(設計書 2026-11-06「型と表」)。判定の表(agentScreenClassifiers.ts)と同じく、呼ぶ側は
// タブの種類で引く。claude の規則で copilot の画面を読まない(L-041)

/** 種類を足したときの決め忘れを型エラーにする */
export const AGENT_PERMISSION_PROMPT_READERS: Record<AgentCliKind, AgentPermissionPromptReader> = {
  claude: readClaudePermissionPrompt,
  copilot: readCopilotPermissionPrompt
}

/**
 * 描画に使う読み取り: 判定が permission の画面だけ、その種類の規則で読む(判定と読み取りを同じ行で行う。L-041)。許可待ちでない・
 * 読み取れないなら null。押した時点の判定(checkAgentPermissionAnswerAtPress)は「許可待ちでない」と「読み取れない」で理由を分けるため使わない
 */
export function readAgentPermissionPromptFor(
  kind: AgentCliKind,
  lines: readonly ViewportLine[]
): AgentPermissionPrompt | null {
  if (classifyAgentScreenFor(kind, lines) !== 'permission') return null
  return AGENT_PERMISSION_PROMPT_READERS[kind](lines)
}
