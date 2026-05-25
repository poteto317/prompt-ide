import { useCallback } from 'react'
import type { Prompt } from '../types'
import * as promptsApi from '../lib/promptsApi'

interface PromptsPersistence {
  load: () => Promise<Prompt[]>
  save: (prompts: Prompt[]) => void
}

export function usePromptsPersistence(): PromptsPersistence {
  const load = useCallback(async (): Promise<Prompt[]> => {
    try {
      return await promptsApi.loadPrompts()
    } catch (err) {
      console.error('[usePromptsPersistence] load failed:', err)
      return []
    }
  }, [])

  const save = useCallback((prompts: Prompt[]): void => {
    promptsApi.savePrompts(prompts).catch((err) =>
      console.error('[usePromptsPersistence] save failed:', err)
    )
  }, [])

  return { load, save }
}
