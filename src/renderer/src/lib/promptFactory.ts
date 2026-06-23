import type { Prompt } from '../types'

export function createPrompt(title: string, content: string): Prompt {
  return { id: crypto.randomUUID(), title, content, createdAt: Date.now() }
}

/** id のみ再生成して複製する。インポート時の id 衝突回避に使用。 */
export function cloneAsNewPrompt(prompt: Prompt): Prompt {
  return { ...prompt, id: crypto.randomUUID() }
}
