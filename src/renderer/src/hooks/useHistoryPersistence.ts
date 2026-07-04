import { useCallback } from 'react'
import type { HistoryEntry } from '../types'
import * as historyApi from '../lib/historyApi'

interface HistoryPersistence {
  load: () => Promise<HistoryEntry[]>
  save: (entries: HistoryEntry[]) => void
}

export function useHistoryPersistence(): HistoryPersistence {
  const load = useCallback(async (): Promise<HistoryEntry[]> => {
    try {
      return await historyApi.loadHistory()
    } catch (err) {
      console.error('[useHistoryPersistence] load failed:', err)
      return []
    }
  }, [])

  const save = useCallback((entries: HistoryEntry[]): void => {
    historyApi
      .saveHistory(entries)
      .catch((err) => console.error('[useHistoryPersistence] save failed:', err))
  }, [])

  return { load, save }
}
