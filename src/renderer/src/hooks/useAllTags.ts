import { useMemo } from 'react'
import type { Prompt } from '../types'

export function useAllTags(prompts: Prompt[]): string[] {
  return useMemo(() => {
    const tagSet = new Set<string>()
    for (const p of prompts) {
      p.tags?.forEach((t) => tagSet.add(t))
    }
    return Array.from(tagSet).sort()
  }, [prompts])
}
