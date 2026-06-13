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
      // インデックス計算を transform 内部で行うことで、常に最新の配列を基準に並び替える
      // （クロージャの prompts を参照しないため stale closure を回避し、参照も安定する）。
      // 順序が変わらない場合は同一参照を返し、apply 側の no-op 検出で save をスキップする。
      apply((currentPrompts) => {
        const activeIndex = currentPrompts.findIndex((p) => p.id === activeId)
        const overIndex = currentPrompts.findIndex((p) => p.id === overId)
        if (activeIndex === -1 || overIndex === -1 || activeIndex === overIndex) {
          return currentPrompts
        }
        return arrayMove(currentPrompts, activeIndex, overIndex)
      })
    },
    [apply]
  )

  return { prompts, promptsLoaded, addPrompt, deletePrompt, updatePrompt, reorderPrompts }
}
