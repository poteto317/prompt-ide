import type { Stage, StageEvent, StageId, StageStatus, Task } from '@shared/types'
import { STAGE_IDS, STAGE_STATUSES } from './progressConstants'

function isStageId(value: unknown): value is StageId {
  return typeof value === 'string' && (STAGE_IDS as readonly string[]).includes(value)
}

function isStageStatus(value: unknown): value is StageStatus {
  return typeof value === 'string' && (STAGE_STATUSES as readonly string[]).includes(value)
}

function isValidMeta(value: unknown): value is Record<string, string> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  return Object.values(value as Record<string, unknown>).every((v) => typeof v === 'string')
}

function isValidStageEvent(item: unknown): item is StageEvent {
  if (typeof item !== 'object' || item === null) return false
  const e = item as Record<string, unknown>
  if (typeof e.id !== 'string') return false
  if (typeof e.occurredAt !== 'number' || !Number.isFinite(e.occurredAt)) return false
  if (e.note !== undefined && typeof e.note !== 'string') return false
  if (e.meta !== undefined && !isValidMeta(e.meta)) return false
  return true
}

function isValidStage(item: unknown): item is Stage {
  if (typeof item !== 'object' || item === null) return false
  const s = item as Record<string, unknown>
  if (!isStageId(s.id)) return false
  if (!isStageStatus(s.status)) return false
  if (!Array.isArray(s.events)) return false
  return s.events.every(isValidStageEvent)
}

export function isValidTask(item: unknown): item is Task {
  if (typeof item !== 'object' || item === null) return false
  const t = item as Record<string, unknown>
  if (typeof t.id !== 'string') return false
  if (typeof t.title !== 'string') return false
  if (typeof t.createdAt !== 'number' || !Number.isFinite(t.createdAt)) return false
  if (typeof t.updatedAt !== 'number' || !Number.isFinite(t.updatedAt)) return false
  if (!isStageId(t.currentStageId)) return false
  if (!Array.isArray(t.stages)) return false
  return t.stages.every(isValidStage)
}
