import type { Stage, StageEvent, StageId, StageStatus, Task } from '@shared/types'
import { isObjectLike, isOneOf, isPlainObject } from '@shared/typeGuards'
import { STAGE_IDS, STAGE_STATUSES } from './progressConstants'

function isStageId(value: unknown): value is StageId {
  return isOneOf(STAGE_IDS, value)
}

function isStageStatus(value: unknown): value is StageStatus {
  return isOneOf(STAGE_STATUSES, value)
}

function isValidMeta(value: unknown): value is Record<string, string> {
  if (!isPlainObject(value)) return false
  return Object.values(value).every((v) => typeof v === 'string')
}

function isValidStageEvent(item: unknown): item is StageEvent {
  if (!isObjectLike(item)) return false
  const e = item
  if (typeof e.id !== 'string') return false
  if (typeof e.occurredAt !== 'number' || !Number.isFinite(e.occurredAt)) return false
  if (e.note !== undefined && typeof e.note !== 'string') return false
  if (e.meta !== undefined && !isValidMeta(e.meta)) return false
  return true
}

function isValidStage(item: unknown): item is Stage {
  if (!isObjectLike(item)) return false
  const s = item
  if (!isStageId(s.id)) return false
  if (!isStageStatus(s.status)) return false
  if (!Array.isArray(s.events)) return false
  return s.events.every(isValidStageEvent)
}

export function isValidTask(item: unknown): item is Task {
  if (!isObjectLike(item)) return false
  const t = item
  if (typeof t.id !== 'string') return false
  if (typeof t.title !== 'string') return false
  if (typeof t.createdAt !== 'number' || !Number.isFinite(t.createdAt)) return false
  if (typeof t.updatedAt !== 'number' || !Number.isFinite(t.updatedAt)) return false
  const currentStageId = t.currentStageId
  if (!isStageId(currentStageId)) return false
  // Array.isArray は any[] に絞り込むため、要素を unknown として受け直してから検証で Stage[] に絞り込む
  if (!Array.isArray(t.stages)) return false
  const stages: readonly unknown[] = t.stages
  if (!stages.every(isValidStage)) return false
  const stageIds: StageId[] = stages.map((s) => s.id)
  if (new Set(stageIds).size !== stageIds.length) return false
  if (!STAGE_IDS.every((id) => stageIds.includes(id))) return false
  if (!stageIds.includes(currentStageId)) return false
  return true
}
