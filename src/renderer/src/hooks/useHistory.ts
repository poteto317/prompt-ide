import { useCallback } from 'react'
import type { HistoryEntry } from '../types'
import { createHistoryEntry } from '../lib/historyEntryFactory'
import { useHistoryPersistence } from './useHistoryPersistence'
import { useBufferedPersistence } from './useBufferedPersistence'

const HISTORY_CAP = 200

interface HistoryState {
  history: HistoryEntry[]
  historyLoaded: boolean
  addHistoryEntry: (entry: Omit<HistoryEntry, 'id'>) => void
  deleteHistoryEntry: (id: string) => void
  clearHistory: () => void
}

export function useHistory(): HistoryState {
  const { load, save } = useHistoryPersistence()
  const {
    items: history,
    loaded: historyLoaded,
    apply
  } = useBufferedPersistence<HistoryEntry>({ load, save })

  const addHistoryEntry = useCallback(
    (entry: Omit<HistoryEntry, 'id'>): void => {
      // ロード完了前は apply が transform をバッファリングし、ロード後に再実行する。
      // createHistoryEntry を transform 内で呼ぶと再実行のたびに別の id が採番されてしまうため、
      // 先に確定させた newEntry をクロージャで捕捉する。
      const newEntry = createHistoryEntry(entry)
      apply((items) => [newEntry, ...items].slice(0, HISTORY_CAP))
    },
    [apply]
  )

  const deleteHistoryEntry = useCallback(
    (id: string): void => {
      apply((items) => {
        const next = items.filter((item) => item.id !== id)
        return next.length === items.length ? items : next
      })
    },
    [apply]
  )

  const clearHistory = useCallback((): void => {
    apply((items) => (items.length === 0 ? items : []))
  }, [apply])

  return { history, historyLoaded, addHistoryEntry, deleteHistoryEntry, clearHistory }
}
