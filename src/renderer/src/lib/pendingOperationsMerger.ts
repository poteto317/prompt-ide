import type { Prompt } from '../types'

export type PendingOp =
  | { type: 'add'; prompt: Prompt }
  | { type: 'delete'; id: string }
  | { type: 'update'; id: string; title: string; content: string }

export function mergePendingOps(loaded: Prompt[], pending: PendingOp[]): Prompt[] {
  let merged = loaded
  for (const op of pending) {
    if (op.type === 'add') {
      merged = [...merged, op.prompt]
    } else if (op.type === 'delete') {
      merged = merged.filter((p) => p.id !== op.id)
    } else {
      merged = merged.map((p) => (p.id === op.id ? { ...p, title: op.title, content: op.content } : p))
    }
  }
  return merged
}
