import type { HistoryStatus, PromptToolId } from '@shared/types'
import { EXECUTION_TOOLS } from '@shared/types'

export function getToolLabel(toolId: PromptToolId): string {
  return EXECUTION_TOOLS.find((tool) => tool.id === toolId)?.label ?? toolId
}

export function formatExecutedAt(executedAt: number): string {
  return new Date(executedAt).toLocaleString()
}

export function getStatusLabel(status: HistoryStatus): string {
  return status === 'success' ? '成功' : 'エラー'
}
