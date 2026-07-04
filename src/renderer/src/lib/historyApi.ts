import type { HistoryEntry } from '../types'

export function loadHistory(): Promise<HistoryEntry[]> {
  return window.api.loadHistory()
}

export function saveHistory(entries: HistoryEntry[]): Promise<void> {
  return window.api.saveHistory(entries)
}
