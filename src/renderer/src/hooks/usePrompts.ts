import { useState, useEffect, useCallback, useRef } from 'react'
import type { Prompt } from '../types'
import { createPrompt } from '../lib/promptFactory'
import { usePromptsPersistence } from './usePromptsPersistence'
import { mergePendingOps, type PendingOp } from '../lib/pendingOperationsMerger'

interface PromptsState {
  prompts: Prompt[]
  promptsLoaded: boolean
  addPrompt: (title: string, content: string) => void
  deletePrompt: (id: string) => void
  updatePrompt: (id: string, title: string, content: string) => void
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
    let cancelled = false
    load().then((loaded) => {
      if (cancelled) return
      const merged = mergePendingOps(loaded, pendingOpsRef.current)
      loadedRef.current = true
      promptsRef.current = merged
      setPrompts(merged)
      if (pendingOpsRef.current.length > 0) save(merged)
      pendingOpsRef.current = []
      setPromptsLoaded(true)
    })
    return () => {
      cancelled = true
    }
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

  const updatePrompt = useCallback(
    (id: string, title: string, content: string): void => {
      if (!loadedRef.current) {
        pendingOpsRef.current = [...pendingOpsRef.current, { type: 'update', id, title, content }]
        const next = promptsRef.current.map((p) => (p.id === id ? { ...p, title, content } : p))
        promptsRef.current = next
        setPrompts(next)
        return
      }
      const next = promptsRef.current.map((p) => (p.id === id ? { ...p, title, content } : p))
      promptsRef.current = next
      setPrompts(next)
      save(next)
    },
    [save]
  )

  return { prompts, promptsLoaded, addPrompt, deletePrompt, updatePrompt }
}
