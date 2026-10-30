'use client'

import type { GitGraphRow, GitGraphSegment } from '../../lib/gitGraph'

const ROW_HEIGHT = 22
const LANE_WIDTH = 11
const CENTER_Y = ROW_HEIGHT / 2
const CIRCLE_RADIUS = 4
const MERGE_INNER_RADIUS = 2
const LINE_WIDTH = 1.5
const HEAD_RING_WIDTH = 2
// 輪の内側を塗る色(サイドバーの背景)。fill="none" だと、輪の内側に線が透けて見える
const RING_FILL = '#252526'

const laneCenterX = (lane: number): number => lane * LANE_WIDTH + LANE_WIDTH / 2

function buildSegmentPath({ kind, fromLane, toLane }: GitGraphSegment): string {
  const x1 = laneCenterX(fromLane)
  const x2 = laneCenterX(toLane)
  const quarterY = ROW_HEIGHT / 4
  switch (kind) {
    case 'through':
      return `M ${x1} 0 C ${x1} ${CENTER_Y}, ${x2} ${CENTER_Y}, ${x2} ${ROW_HEIGHT}`
    case 'toCircle':
      return `M ${x1} 0 C ${x1} ${quarterY}, ${x2} ${quarterY}, ${x2} ${CENTER_Y}`
    case 'fromCircle':
      return `M ${x1} ${CENTER_Y} C ${x1} ${CENTER_Y + quarterY}, ${x2} ${CENTER_Y + quarterY}, ${x2} ${ROW_HEIGHT}`
  }
}

// 通常は塗りつぶし、HEAD は太い輪、マージは輪と内側の小さい円。HEAD がマージコミットでも HEAD の輪を優先する
function CommitCircle({ row }: { row: GitGraphRow }): React.JSX.Element {
  const { entry, circleColor } = row
  const center = { cx: laneCenterX(row.circleLane), cy: CENTER_Y }
  if (entry.isHead) {
    return (
      <circle
        {...center}
        r={CIRCLE_RADIUS}
        fill={RING_FILL}
        stroke={circleColor}
        strokeWidth={HEAD_RING_WIDTH}
      />
    )
  }
  if (entry.parents.length >= 2) {
    return (
      <>
        <circle
          {...center}
          r={CIRCLE_RADIUS}
          fill={RING_FILL}
          stroke={circleColor}
          strokeWidth={LINE_WIDTH}
        />
        <circle {...center} r={MERGE_INNER_RADIUS} fill={circleColor} />
      </>
    )
  }
  return <circle {...center} r={CIRCLE_RADIUS} fill={circleColor} />
}

interface Props {
  row: GitGraphRow
}

// viewBox を付けない。付けると CSS の max-width で幅が縮んだとき、超えた分が切れずに全体が縮小される
export default function GitGraphCell({ row }: Props): React.JSX.Element {
  return (
    <svg
      className="history-section__graph"
      width={row.laneCount * LANE_WIDTH}
      height={ROW_HEIGHT}
      aria-hidden="true"
    >
      {row.segments.map((segment) => (
        <path
          key={`${segment.kind}:${segment.fromLane}:${segment.toLane}`}
          d={buildSegmentPath(segment)}
          fill="none"
          stroke={segment.color}
          strokeWidth={LINE_WIDTH}
        />
      ))}
      <CommitCircle row={row} />
    </svg>
  )
}
