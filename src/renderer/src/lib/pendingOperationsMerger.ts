import type { Prompt } from '../types'

export type PendingOp = { type: 'add'; prompt: Prompt } | { type: 'delete'; id: string }

export function mergePendingOps(loaded: Prompt[], pending: PendingOp[]): Prompt[] {
  let merged = loaded
  for (const op of pending) {
    merged =
      op.type === 'add'
        ? [...merged, op.prompt]
        : merged.filter((p) => p.id !== op.id)
  }
  return merged
}
