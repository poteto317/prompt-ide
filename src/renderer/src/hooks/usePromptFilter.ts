import { useState, useMemo } from 'react'
import type { Prompt } from '../types'

export function usePromptFilter(prompts: Prompt[]) {
  const [query, setQuery] = useState('')

  const filteredPrompts = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return prompts
    return prompts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        p.content.toLowerCase().includes(q)
    )
  }, [prompts, query])

  return { filteredPrompts, query, setQuery }
}
