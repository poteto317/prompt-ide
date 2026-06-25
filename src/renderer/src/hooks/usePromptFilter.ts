import { useState, useMemo, useEffect, useRef } from 'react'
import type { Prompt } from '../types'
import { useTagFilter } from './useTagFilter'

interface Options {
  isActive?: boolean
}

export function usePromptFilter(prompts: Prompt[], { isActive }: Options = {}) {
  const [query, setQuery] = useState('')
  const { selectedTags, toggleTag, resetTags } = useTagFilter()
  const prevIsActiveRef = useRef(isActive)

  useEffect(() => {
    if (prompts.length === 0) {
      setQuery('')
      resetTags()
    }
  }, [prompts.length, resetTags])

  useEffect(() => {
    const wasActive = prevIsActiveRef.current
    prevIsActiveRef.current = isActive
    if (wasActive && isActive === false) {
      setQuery('')
      resetTags()
    }
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

  return { filteredPrompts, query, setQuery, selectedTags, toggleTag }
}
