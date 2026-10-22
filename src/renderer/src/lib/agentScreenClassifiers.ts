import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'
import { classifyClaudeScreen } from './claudeScreenActivity'
import { classifyCopilotScreen } from './copilotScreenActivity'

// CLI の種類ごとの画面の判定の表(設計書 2026-10-21「判定の表」)。判定を呼ぶ側(useAgentActivity・中断の押した時点の読み直し・
// 2 回目の前の確かめ)はタブの種類を渡して表から引く。claude の規則で copilot の画面を読まない(L-041)

/** 画面の末尾の行から活動を判定する純粋関数。行は読むだけで、例外は投げない */
export type AgentScreenClassifier = (lines: readonly ViewportLine[]) => AgentActivity

/** CLI の種類ごとの判定。種類を足したときの決め忘れを型エラーにする。CLI どうしの規則を混ぜない */
export const AGENT_SCREEN_CLASSIFIERS: Record<AgentCliKind, AgentScreenClassifier> = {
  claude: classifyClaudeScreen,
  copilot: classifyCopilotScreen
}

export function classifyAgentScreenFor(
  kind: AgentCliKind,
  lines: readonly ViewportLine[]
): AgentActivity {
  return AGENT_SCREEN_CLASSIFIERS[kind](lines)
}
