import { useState } from 'react'
import type { Prompt } from '../types'
import { createPrompt } from '../lib/promptFactory'

interface PromptsState {
  prompts: Prompt[]
  addPrompt: (title: string, content: string) => void
  deletePrompt: (id: string) => void
}

export function usePrompts(): PromptsState {
  const [prompts, setPrompts] = useState<Prompt[]>([])

  const addPrompt = (title: string, content: string): void => {
    setPrompts((prev) => [...prev, createPrompt(title, content)])
  }

  const deletePrompt = (id: string): void => {
    setPrompts((prev) => prev.filter((p) => p.id !== id))
  }

  return { prompts, addPrompt, deletePrompt }
}
