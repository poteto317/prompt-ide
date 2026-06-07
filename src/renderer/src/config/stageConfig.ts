import type { StageId, StageKind } from '../types'

export interface StageDefinition {
  id: StageId
  label: string
  kind: StageKind
}

export const STAGES = [
  { id: 'plan', label: 'プラン作成', kind: 'revisable' },
  { id: 'implement', label: '機能の実装', kind: 'revisable' },
  { id: 'refactor', label: '単一責任にリファクタリング', kind: 'repeatable' },
  { id: 'localReview', label: 'ローカルレビュー', kind: 'repeatable' },
  { id: 'commit', label: 'コミット', kind: 'repeatable' },
  { id: 'prCreate', label: 'PR 作成', kind: 'once' },
  { id: 'prReview', label: 'PR コードレビュー', kind: 'repeatable' },
  { id: 'prMerge', label: 'PR マージ', kind: 'once' }
] as const satisfies readonly StageDefinition[]

export const STAGE_IDS = STAGES.map((s) => s.id) as StageId[]
