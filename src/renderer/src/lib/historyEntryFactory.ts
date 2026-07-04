import type { HistoryEntry } from '../types'

export function createHistoryEntry(entry: Omit<HistoryEntry, 'id'>): HistoryEntry {
  return { ...entry, id: crypto.randomUUID() }
}
