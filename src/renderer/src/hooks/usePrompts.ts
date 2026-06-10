import { useCallback } from 'react'
import { arrayMove } from '@dnd-kit/sortable'
import type { Prompt } from '../types'
import { createPrompt } from '../lib/promptFactory'
import { usePromptsPersistence } from './usePromptsPersistence'
import { useBufferedPersistence } from './useBufferedPersistence'

interface PromptsState {
  prompts: Prompt[]
  promptsLoaded: boolean
  addPrompt: (title: string, content: string) => void
  deletePrompt: (id: string) => void
  updatePrompt: (id: string, title: string, content: string) => void
  reorderPrompts: (activeId: string, overId: string) => void
}

export function usePrompts(): PromptsState {
  const { load, save } = usePromptsPersistence()
  const {
    items: prompts,
    loaded: promptsLoaded,
    apply
  } = useBufferedPersistence<Prompt>({ load, save })

  const addPrompt = useCallback(
    (title: string, content: string): void => {
      const newPrompt = createPrompt(title, content)
      apply((prompts) => [...prompts, newPrompt])
    },
    [apply]
  )

  const deletePrompt = useCallback(
    (id: string): void => {
      apply((prompts) => prompts.filter((p) => p.id !== id))
    },
    [apply]
  )

  const updatePrompt = useCallback(
    (id: string, title: string, content: string): void => {
      apply((prompts) => prompts.map((p) => (p.id === id ? { ...p, title, content } : p)))
    },
    [apply]
  )

  const reorderPrompts = useCallback(
    (activeId: string, overId: string): void => {
      apply((prompts) => {
        const activeIndex = prompts.findIndex((p) => p.id === activeId)
        const overIndex = prompts.findIndex((p) => p.id === overId)
        if (activeIndex === -1 || overIndex === -1) return prompts
        return arrayMove(prompts, activeIndex, overIndex)
      })
    },
    [apply]
  )

  return { prompts, promptsLoaded, addPrompt, deletePrompt, updatePrompt, reorderPrompts }
}
