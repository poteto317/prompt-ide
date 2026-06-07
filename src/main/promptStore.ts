import { createJsonCollectionStore } from './jsonCollectionStore'
import { isValidPrompt, sanitizePrompt } from './promptUtils'
import type { Prompt } from '@shared/types'

const store = createJsonCollectionStore<Prompt>({
  fileName: 'prompts.json',
  isValid: isValidPrompt,
  sanitize: sanitizePrompt
})

export function loadPrompts(): Promise<Prompt[]> {
  return store.load()
}

export function savePrompts(prompts: Prompt[]): Promise<void> {
  return store.save(prompts)
}
