'use client'
export default function StageLegend() {
  return (
    <dl className="stage-legend" aria-label="凡例">
      <div className="stage-legend__item">
        <dt className="stage-legend__icon">●</dt>
        <dd className="stage-legend__label">完了</dd>
      </div>
      <div className="stage-legend__item">
        <dt className="stage-legend__icon">◐</dt>
        <dd className="stage-legend__label">進行中</dd>
      </div>
      <div className="stage-legend__item">
        <dt className="stage-legend__icon">○</dt>
        <dd className="stage-legend__label">未着手</dd>
      </div>
      <div className="stage-legend__item">
        <dt className="stage-legend__icon">⊘</dt>
        <dd className="stage-legend__label">スキップ</dd>
      </div>
    </dl>
  )
}
