import type { Prompt } from '../types'

export function loadPrompts(): Promise<Prompt[]> {
  return window.api.loadPrompts()
}

export function savePrompts(prompts: Prompt[]): Promise<void> {
  return window.api.savePrompts(prompts)
}
