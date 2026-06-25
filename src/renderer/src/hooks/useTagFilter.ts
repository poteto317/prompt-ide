import { useState, useCallback } from 'react'

export interface TagFilterState {
  selectedTags: string[]
  toggleTag: (tag: string) => void
  resetTags: () => void
}

export function useTagFilter(): TagFilterState {
  const [selectedTags, setSelectedTags] = useState<string[]>([])

  const toggleTag = useCallback((tag: string): void => {
    setSelectedTags((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    )
  }, [])

  const resetTags = useCallback((): void => {
    setSelectedTags([])
  }, [])

  return { selectedTags, toggleTag, resetTags }
}
