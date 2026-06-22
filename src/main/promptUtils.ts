import type { Prompt } from '@shared/types'

export function isValidPrompt(item: unknown): item is Prompt {
  if (typeof item !== 'object' || item === null) return false
  const p = item as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.title === 'string' &&
    typeof p.content === 'string' &&
    typeof p.createdAt === 'number' &&
    Number.isFinite(p.createdAt) &&
    // pinned は任意。存在する場合は boolean のみ許可
    (p.pinned === undefined || typeof p.pinned === 'boolean')
  )
}

export function sanitizePrompt(item: Prompt): Prompt {
  const { id, title, content, createdAt } = item
  const base: Prompt = { id, title, content, createdAt }
  // pinned は boolean のときだけ保持（未指定は付与しない＝未ピン扱い）
  if (typeof item.pinned === 'boolean') base.pinned = item.pinned
  return base
}
