import { useState } from 'react'

export interface TagInputState {
  tags: string[]
  tagInput: string
  handleTagInputChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  handleTagInputKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void
  handleRemoveTag: (tag: string) => void
}

export function useTagInput(initialTags: string[] = []): TagInputState {
  const [tags, setTags] = useState<string[]>(initialTags)
  const [tagInput, setTagInput] = useState('')

  const handleTagInputChange = (e: React.ChangeEvent<HTMLInputElement>): void => {
    setTagInput(e.target.value)
  }

  const handleTagInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.key !== 'Enter') return
    e.preventDefault()
    const trimmed = tagInput.trim()
    if (trimmed && !tags.includes(trimmed)) {
      setTags((prev) => [...prev, trimmed])
    }
    setTagInput('')
  }

  const handleRemoveTag = (tag: string): void => {
    setTags((prev) => prev.filter((t) => t !== tag))
  }

  return { tags, tagInput, handleTagInputChange, handleTagInputKeyDown, handleRemoveTag }
}
