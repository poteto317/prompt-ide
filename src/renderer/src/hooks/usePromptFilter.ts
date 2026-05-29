import { useState, useMemo, useEffect, useRef } from 'react'
import type { Prompt } from '../types'

interface Options {
  isActive?: boolean
}

export function usePromptFilter(prompts: Prompt[], { isActive }: Options = {}) {
  const [query, setQuery] = useState('')
  const prevIsActiveRef = useRef(isActive)

  useEffect(() => {
    if (prompts.length === 0) setQuery('')
  }, [prompts.length])

  useEffect(() => {
    const wasActive = prevIsActiveRef.current
    prevIsActiveRef.current = isActive
    if (wasActive && isActive === false) setQuery('')
  }, [isActive])

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
