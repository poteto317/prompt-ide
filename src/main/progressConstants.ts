import type { StageId, StageStatus } from '@shared/types'

export const STAGE_IDS: readonly StageId[] = [
  'plan',
  'implement',
  'refactor',
  'localReview',
  'commit',
  'prCreate',
  'prReview',
  'prMerge'
]

export const STAGE_STATUSES: readonly StageStatus[] = [
  'not_started',
  'in_progress',
  'done',
  'skipped'
]
