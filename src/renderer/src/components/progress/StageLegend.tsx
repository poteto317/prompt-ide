'use client'
import { statusIcon, statusLabel } from '../../lib/statusDisplay'
import type { StageStatus } from '../../types'

const LEGEND_STATUSES: StageStatus[] = ['done', 'in_progress', 'not_started', 'skipped']

export default function StageLegend() {
  return (
    <dl className="stage-legend" aria-label="凡例">
      {LEGEND_STATUSES.map((status) => (
        <div key={status} className="stage-legend__item">
          <dt className="stage-legend__icon">{statusIcon(status)}</dt>
          <dd className="stage-legend__label">{statusLabel(status)}</dd>
        </div>
      ))}
    </dl>
  )
}
