import type { StageEvent } from '../types'

export function createStageEvent(note?: string, meta?: Record<string, string>): StageEvent {
  const event: StageEvent = { id: crypto.randomUUID(), occurredAt: Date.now() }
  if (note !== undefined && note !== '') event.note = note
  if (meta !== undefined) event.meta = meta
  return event
}
