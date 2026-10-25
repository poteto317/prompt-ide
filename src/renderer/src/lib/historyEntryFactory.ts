import type { AgentHistoryInfo, HistoryEntry } from '../types'

export function createHistoryEntry(entry: Omit<HistoryEntry, 'id'>): HistoryEntry {
  return { ...entry, id: crypto.randomUUID() }
}

/**
 * エージェント CLI 方式で送れたときの履歴のエントリ(結果の文章は記録しない。status は sent、ツールは claude)。
 * text は送った全文(参照を足した後)、sentTo は送信の手順を始める時点に控えた送り先(送り先のタブの CLI の種類を含む)。
 * toolId は従来の方式の claude のまま(従来の方式の copilot は gh copilot -p を指すので流用しない。種類は agent.cliKind とタブ名で分かる)
 */
export function buildAgentSentHistoryEntry(
  context: Pick<HistoryEntry, 'promptId' | 'promptTitle'>,
  text: string,
  sentTo: AgentHistoryInfo,
  executedAt: number
): Omit<HistoryEntry, 'id'> {
  return {
    promptId: context.promptId,
    promptTitle: context.promptTitle,
    promptContent: text,
    fileContent: null,
    toolId: 'claude',
    status: 'sent',
    resultText: null,
    errorMessage: null,
    executedAt,
    agent: sentTo
  }
}
