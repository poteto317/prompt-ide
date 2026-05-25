import { useState, useEffect, useCallback, useRef } from 'react'
import type { Prompt } from '../types'
import { createPrompt } from '../lib/promptFactory'
import { usePromptsPersistence } from './usePromptsPersistence'

type PendingOp = { type: 'add'; prompt: Prompt } | { type: 'delete'; id: string }

interface PromptsState {
  prompts: Prompt[]
  promptsLoaded: boolean
  addPrompt: (title: string, content: string) => void
  deletePrompt: (id: string) => void
}

export function usePrompts(): PromptsState {
  const { load, save } = usePromptsPersistence()
  const promptsRef = useRef<Prompt[]>([])
  const [prompts, setPrompts] = useState<Prompt[]>([])
  const [promptsLoaded, setPromptsLoaded] = useState(false)
  // ロード完了前のミューテーションを保持し、ロード後にマージして適用する
  const pendingOpsRef = useRef<PendingOp[]>([])
  const loadedRef = useRef(false)

  useEffect(() => {
    load().then((loaded) => {
      let merged = loaded
      for (const op of pendingOpsRef.current) {
        merged =
          op.type === 'add'
            ? [...merged, op.prompt]
            : merged.filter((p) => p.id !== op.id)
      }
      loadedRef.current = true
      promptsRef.current = merged
      setPrompts(merged)
      if (pendingOpsRef.current.length > 0) {
        save(merged)
      }
      setPromptsLoaded(true)
    })
  }, [load, save])

  const addPrompt = useCallback(
    (title: string, content: string): void => {
      const newPrompt = createPrompt(title, content)
      if (!loadedRef.current) {
        pendingOpsRef.current = [...pendingOpsRef.current, { type: 'add', prompt: newPrompt }]
        const next = [...promptsRef.current, newPrompt]
        promptsRef.current = next
        setPrompts(next)
        return
      }
      const next = [...promptsRef.current, newPrompt]
      promptsRef.current = next
      setPrompts(next)
      save(next)
    },
    [save]
  )

  const deletePrompt = useCallback(
    (id: string): void => {
      if (!loadedRef.current) {
        pendingOpsRef.current = [...pendingOpsRef.current, { type: 'delete', id }]
        const next = promptsRef.current.filter((p) => p.id !== id)
        promptsRef.current = next
        setPrompts(next)
        return
      }
      const next = promptsRef.current.filter((p) => p.id !== id)
      promptsRef.current = next
      setPrompts(next)
      save(next)
    },
    [save]
  )

  return { prompts, promptsLoaded, addPrompt, deletePrompt }
}
