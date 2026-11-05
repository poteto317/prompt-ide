// 指示ファイルの節の固定の文言(設計書 2026-11-05)。main の例外の文言は画面に出さない(L-017)。
// 画面に出さない理由(folderChanged)には文言を持たせない
import type { AgentInstructionCreateShownFailureReason } from '@shared/types'

const FAILURE_MESSAGES: Record<AgentInstructionCreateShownFailureReason, string> = {
  exists:
    '同じ名前のファイルかフォルダが既にあります(大文字と小文字だけ違う名前を含みます)。ファイルツリーを確かめてください',
  outside: 'フォルダの外には作成できません',
  failed: '指示ファイルを作成できませんでした'
}

export function agentInstructionCreateFailureMessage(
  reason: AgentInstructionCreateShownFailureReason
): string {
  return FAILURE_MESSAGES[reason]
}

export const AGENT_INSTRUCTION_OPEN_AFTER_CREATE_FAILED =
  '作成しましたが、開けませんでした。ファイルツリーから開いてください'
