import type { Prompt } from '@shared/types'

export function isValidPrompt(item: unknown): item is Prompt {
  if (typeof item !== 'object' || item === null) return false
  const p = item as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.title === 'string' &&
    typeof p.content === 'string' &&
    typeof p.createdAt === 'number' &&
    Number.isFinite(p.createdAt)
  )
}

export function sanitizePrompt(item: Prompt): Prompt {
  const { id, title, content, createdAt } = item
  return { id, title, content, createdAt }
}
