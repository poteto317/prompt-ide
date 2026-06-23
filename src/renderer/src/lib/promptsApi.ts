import type { Prompt } from '../types'

export function loadPrompts(): Promise<Prompt[]> {
  return window.api.loadPrompts()
}

export function savePrompts(prompts: Prompt[]): Promise<void> {
  return window.api.savePrompts(prompts)
}

export function exportPrompts(prompts: Prompt[]): Promise<boolean> {
  return window.api.exportPrompts(prompts)
}

export function importPrompts(): Promise<Prompt[] | null> {
  return window.api.importPrompts()
}
