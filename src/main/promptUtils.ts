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
    (p.pinned === undefined || typeof p.pinned === 'boolean') &&
    // tags は任意。存在する場合は全要素が string の配列のみ許可
    (p.tags === undefined ||
      (Array.isArray(p.tags) && p.tags.every((t) => typeof t === 'string')))
  )
}

export function sanitizePrompt(item: Prompt): Prompt {
  const { id, title, content, createdAt } = item
  const base: Prompt = { id, title, content, createdAt }
  // pinned は boolean のときだけ保持（未指定は付与しない＝未ピン扱い）
  if (typeof item.pinned === 'boolean') base.pinned = item.pinned
  // tags は有効な string[] のときだけ保持
  if (Array.isArray(item.tags) && item.tags.every((t) => typeof t === 'string')) {
    base.tags = item.tags
  }
  return base
}
