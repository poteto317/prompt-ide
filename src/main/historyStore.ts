import { createJsonCollectionStore } from './jsonCollectionStore'
import { isValidHistoryEntry, sanitizeHistoryEntry } from './historyUtils'
import type { HistoryEntry } from '@shared/types'

const store = createJsonCollectionStore<HistoryEntry>({
  fileName: 'history.json',
  isValid: isValidHistoryEntry,
  sanitize: sanitizeHistoryEntry
})

export function loadHistory(): Promise<HistoryEntry[]> {
  return store.load()
}

export function saveHistory(entries: HistoryEntry[]): Promise<void> {
  return store.save(entries)
}
