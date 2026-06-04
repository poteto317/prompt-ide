'use client'
import type { Stage, StageKind } from '../../types'
import StageEventList from './StageEventList'
import StageRecordForm from './StageRecordForm'

interface Props {
  stage: Stage
  kind: StageKind
  onRecord: (note?: string) => void
}

export default function StageHistory({ stage, kind, onRecord }: Props) {
  return (
    <div className="stage-history">
      <StageEventList stage={stage} />
      {kind !== 'once' && <StageRecordForm onRecord={onRecord} />}
    </div>
  )
}
