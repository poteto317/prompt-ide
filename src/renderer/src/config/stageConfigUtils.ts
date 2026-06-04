import type { StageId } from '../types'
import { STAGES } from './stageConfig'
import type { StageDefinition } from './stageConfig'

export function getStageDefinition(id: StageId): StageDefinition {
  const def = STAGES.find((s) => s.id === id)
  if (!def) throw new Error(`未知のステージ: ${id}`)
  return def
}

export function getStageIndex(id: StageId): number {
  return STAGES.findIndex((s) => s.id === id)
}
