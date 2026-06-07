export type StageId =
  | 'plan'
  | 'implement'
  | 'refactor'
  | 'localReview'
  | 'commit'
  | 'prCreate'
  | 'prReview'
  | 'prMerge'

export type StageKind = 'once' | 'repeatable' | 'revisable'
export type StageStatus = 'not_started' | 'in_progress' | 'done' | 'skipped'

export type StageEvent = {
  id: string
  occurredAt: number
  note?: string
  meta?: Record<string, string>
}

export type Stage = {
  id: StageId
  status: StageStatus
  events: StageEvent[]
}

export type Task = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  currentStageId: StageId
  stages: Stage[]
}
