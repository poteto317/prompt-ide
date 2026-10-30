import { useState, useMemo, useEffect, useRef } from 'react'
import type { Prompt } from '../types'
import { useTagFilter } from './useTagFilter'

interface Options {
  isActive?: boolean
}

export interface PromptFilterState {
  filteredPrompts: Prompt[]
  query: string
  setQuery: (query: string) => void
  selectedTags: string[]
  toggleTag: (tag: string) => void
  isFiltered: boolean
}

// キーワードとタグの絞り込みを解除する。プロンプトが 0 件になったときと、パネルが非表示になったときの 2 か所で使う。
// useGitStashes の loadStashes と同じく、setState を呼ぶ処理をフック本体の外に置く(react-hooks/set-state-in-effect 対策)
function clearFilter(setQuery: (query: string) => void, resetTags: () => void): void {
  setQuery('')
  resetTags()
}

export function usePromptFilter(prompts: Prompt[], { isActive }: Options = {}): PromptFilterState {
  const [query, setQuery] = useState('')
  const { selectedTags, toggleTag, resetTags } = useTagFilter()
  const prevIsActiveRef = useRef(isActive)

  useEffect(() => {
    if (prompts.length === 0) clearFilter(setQuery, resetTags)
  }, [prompts.length, resetTags])

  useEffect(() => {
    const wasActive = prevIsActiveRef.current
    prevIsActiveRef.current = isActive
    if (wasActive && isActive === false) clearFilter(setQuery, resetTags)
  }, [isActive, resetTags])

  const filteredPrompts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q && selectedTags.length === 0) return prompts
    return prompts.filter((p) => {
      if (q && !p.title.toLowerCase().includes(q) && !p.content.toLowerCase().includes(q)) {
        return false
      }
      if (selectedTags.length > 0 && !selectedTags.every((t) => p.tags?.includes(t))) {
        return false
      }
      return true
    })
  }, [prompts, query, selectedTags])

  const isFiltered = query.trim() !== '' || selectedTags.length > 0
  return { filteredPrompts, query, setQuery, selectedTags, toggleTag, isFiltered }
}
