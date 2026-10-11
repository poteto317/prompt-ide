import type { HistoryEntry, HistoryStatus, PromptToolId } from '@shared/types'
import { EXECUTION_TOOLS } from '@shared/types'

export function getToolLabel(toolId: PromptToolId): string {
  return EXECUTION_TOOLS.find((tool) => tool.id === toolId)?.label ?? toolId
}

/** 履歴の一覧・詳細のツールの欄。エージェントのエントリは送ったタブの名前を添える(toolId は 'claude' のまま変えないため) */
export function getHistoryToolLabel(entry: Pick<HistoryEntry, 'toolId' | 'agent'>): string {
  return entry.agent !== null
    ? `エージェント（${entry.agent.tabLabel}）`
    : getToolLabel(entry.toolId)
}

/** 履歴の一覧のプレビューの元の文章。エージェントのエントリは結果を記録しないため送った全文、従来のエントリは結果かエラー */
export function getHistoryPreviewSource(
  entry: Pick<HistoryEntry, 'status' | 'promptContent' | 'resultText' | 'errorMessage'>
): string {
  return entry.status === 'sent'
    ? entry.promptContent
    : (entry.resultText ?? entry.errorMessage ?? '')
}

export function formatExecutedAt(executedAt: number): string {
  return new Date(executedAt).toLocaleString()
}

export function getStatusLabel(status: HistoryStatus): string {
  switch (status) {
    case 'success':
      return '成功'
    case 'error':
      return 'エラー'
    case 'sent':
      // エージェント CLI 方式は結果を知らないので、成功と出さない
      return '送信済み'
  }
}
