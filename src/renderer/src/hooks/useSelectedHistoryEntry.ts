import { useCallback, useState } from 'react'
import type { HistoryEntry } from '../types'

interface SelectedHistoryEntry {
  selectedEntry: HistoryEntry | null
  selectEntry: (id: string) => void
  deselectIfMatches: (id: string) => void
}

export function useSelectedHistoryEntry(history: HistoryEntry[]): SelectedHistoryEntry {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [prevHistory, setPrevHistory] = useState(history)

  // 新しい実行結果（先頭に追加された、これまで存在しなかった id のエントリ）が現れたら、
  // その最新結果に選択を追従させる（再実行しても表示が古い結果のままになるのを防ぐ）。
  // 先頭以外の削除で既存エントリが繰り上がっただけの場合は「新規」とみなさず、選択を奪わない。
  if (history !== prevHistory) {
    const topId = history[0]?.id ?? null
    const isNewTopEntry = topId !== null && !prevHistory.some((e) => e.id === topId)
    setPrevHistory(history)
    if (isNewTopEntry) setSelectedId(topId)
  }

  // 選択中の履歴が削除された場合は先頭にフォールバック
  const selectedEntry = history.find((e) => e.id === selectedId) ?? history[0] ?? null

  const selectEntry = useCallback((id: string): void => {
    setSelectedId(id)
  }, [])

  const deselectIfMatches = useCallback((id: string): void => {
    setSelectedId((current) => (current === id ? null : current))
  }, [])

  return { selectedEntry, selectEntry, deselectIfMatches }
}
