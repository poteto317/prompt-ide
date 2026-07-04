import type { HistoryEntry, HistoryStatus, PromptToolId } from '@shared/types'
import { EXECUTION_TOOLS } from '@shared/types'

const TOOL_IDS = EXECUTION_TOOLS.map((tool) => tool.id) as readonly string[]

function isPromptToolId(value: unknown): value is PromptToolId {
  return typeof value === 'string' && TOOL_IDS.includes(value)
}

function isHistoryStatus(value: unknown): value is HistoryStatus {
  return value === 'success' || value === 'error'
}

export function isValidHistoryEntry(item: unknown): item is HistoryEntry {
  if (typeof item !== 'object' || item === null) return false
  const h = item as Record<string, unknown>
  return (
    typeof h.id === 'string' &&
    (h.promptId === null || typeof h.promptId === 'string') &&
    typeof h.promptTitle === 'string' &&
    typeof h.promptContent === 'string' &&
    (h.fileContent === null || typeof h.fileContent === 'string') &&
    isPromptToolId(h.toolId) &&
    isHistoryStatus(h.status) &&
    (h.resultText === null || typeof h.resultText === 'string') &&
    (h.errorMessage === null || typeof h.errorMessage === 'string') &&
    typeof h.executedAt === 'number' &&
    Number.isFinite(h.executedAt)
  )
}

export function sanitizeHistoryEntry(item: HistoryEntry): HistoryEntry {
  const {
    id,
    promptId,
    promptTitle,
    promptContent,
    fileContent,
    toolId,
    status,
    resultText,
    errorMessage,
    executedAt
  } = item
  return {
    id,
    promptId,
    promptTitle,
    promptContent,
    fileContent,
    toolId,
    status,
    resultText,
    errorMessage,
    executedAt
  }
}
