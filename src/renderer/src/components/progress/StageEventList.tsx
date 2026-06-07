'use client'
import type { Stage } from '../../types'
import { formatEventDate, formatEventMeta } from '../../lib/stageDisplay'

interface Props {
  stage: Stage
}

export default function StageEventList({ stage }: Props) {
  if (stage.events.length === 0) {
    return <p className="stage-history__empty">履歴はありません</p>
  }

  return (
    <ul className="stage-history__list">
      {stage.events.map((event) => (
        <li key={event.id} className="stage-history__item">
          <span className="stage-history__date">{formatEventDate(event.occurredAt)}</span>
          {event.note && <span className="stage-history__note">{event.note}</span>}
          {event.meta && Object.keys(event.meta).length > 0 && (
            <span className="stage-history__meta">{formatEventMeta(event.meta)}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
