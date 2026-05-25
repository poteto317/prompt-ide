import { useState, useEffect, useCallback, useRef } from 'react'
import type { Prompt } from '../types'
import { createPrompt } from '../lib/promptFactory'
import { usePromptsPersistence } from './usePromptsPersistence'

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
  // ロード完了前にミューテーションが発生したかを追跡し、ロード結果による上書きを防ぐ
  const mutatedRef = useRef(false)

  useEffect(() => {
    load().then((loaded) => {
      if (!mutatedRef.current) {
        promptsRef.current = loaded
        setPrompts(loaded)
      }
      setPromptsLoaded(true)
    })
  }, [load])

  const addPrompt = useCallback(
    (title: string, content: string): void => {
      mutatedRef.current = true
      const next = [...promptsRef.current, createPrompt(title, content)]
      promptsRef.current = next
      setPrompts(next)
      save(next)
    },
    [save]
  )

  const deletePrompt = useCallback(
    (id: string): void => {
      mutatedRef.current = true
      const next = promptsRef.current.filter((p) => p.id !== id)
      promptsRef.current = next
      setPrompts(next)
      save(next)
    },
    [save]
  )

  return { prompts, promptsLoaded, addPrompt, deletePrompt }
}
