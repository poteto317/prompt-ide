import type { Prompt } from '../types'

export function createPrompt(title: string, content: string): Prompt {
  return { id: crypto.randomUUID(), title, content, createdAt: Date.now() }
}
