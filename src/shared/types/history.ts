import type { PromptToolId } from './cli'

export type HistoryStatus = 'success' | 'error'

export type HistoryEntry = {
  id: string
  promptId: string | null
  promptTitle: string
  promptContent: string
  fileContent: string | null
  toolId: PromptToolId
  status: HistoryStatus
  resultText: string | null
  errorMessage: string | null
  executedAt: number
}
