import type { GitLogEntry } from '@shared/types'

// 履歴のグラフの組み立て(VS Code の toISCMHistoryItemViewModelArray と同じ swimlane 方式)。
// 線の対応は id ではなく位置で取る。同じ親を持つレーンが複数あっても線が切れないようにするため
export const GIT_GRAPH_LANE_COLORS = [
  '#FFB000',
  '#DC267F',
  '#994F00',
  '#40B0A6',
  '#B66DFF'
] as const
export const GIT_GRAPH_HEAD_COLOR = '#59A4F9'
export const GIT_GRAPH_UPSTREAM_COLOR = '#B180D7'

export interface GitGraphSegment {
  /** through: 行を素通りする線。toCircle: 上から円へ入る線。fromCircle: 円から下へ出る線 */
  kind: 'through' | 'toCircle' | 'fromCircle'
  fromLane: number
  toLane: number
  color: string
}

export interface GitGraphRow {
  entry: GitLogEntry
  circleLane: number
  circleColor: string
  segments: GitGraphSegment[]
  /** 描画に要るレーン数 */
  laneCount: number
}

interface GitGraphLane {
  /** このレーンの次に現れるコミットのハッシュ */
  id: string
  color: string
}

interface GitGraphOutputLane extends GitGraphLane {
  /** 元の入力レーンの位置。手順 4・5 で新しく足したレーンは null */
  sourceLane: number | null
}

// HEAD と上流の色。HEAD と上流が同じコミットなら HEAD を優先する。upstream は短い名前で、ローカルの上流も
// あるため ref の種類は問わない
function getRefColor(entry: GitLogEntry, upstream: string | null): string | null {
  if (entry.isHead) return GIT_GRAPH_HEAD_COLOR
  if (entry.refs.some((ref) => ref.name === upstream)) return GIT_GRAPH_UPSTREAM_COLOR
  return null
}

// 入力レーンを引き継ぐ。円のレーンは第 1 親のレーンに置き換え(親が無ければ消える)、
// ハッシュに一致する 2 本目以降は捨てる(ここで合流する)
function continueInputLanes(
  inputLanes: readonly GitGraphLane[],
  entry: GitLogEntry,
  circleLane: number,
  circleColor: string
): GitGraphOutputLane[] {
  const firstParent = entry.parents.at(0)
  const outputLanes: GitGraphOutputLane[] = []
  inputLanes.forEach((lane, sourceLane) => {
    if (lane.id !== entry.hash) {
      outputLanes.push({ ...lane, sourceLane })
    } else if (sourceLane === circleLane && firstParent !== undefined) {
      outputLanes.push({ id: firstParent, color: circleColor, sourceLane })
    }
  })
  return outputLanes
}

// 入力レーンから出る線。一致したレーンは円へ、残ったレーンは sourceLane が同じ出力レーンへ向かう
function buildIncomingSegments(
  inputLanes: readonly GitGraphLane[],
  outputLanes: readonly GitGraphOutputLane[],
  entry: GitLogEntry,
  circleLane: number
): GitGraphSegment[] {
  return inputLanes.map((lane, fromLane) => {
    const toCircle = lane.id === entry.hash
    return {
      kind: toCircle ? 'toCircle' : 'through',
      fromLane,
      toLane: toCircle
        ? circleLane
        : outputLanes.findIndex((outputLane) => outputLane.sourceLane === fromLane),
      color: lane.color
    }
  })
}

export function buildGitGraphRows(
  log: readonly GitLogEntry[],
  upstream: string | null
): GitGraphRow[] {
  const entriesByHash = new Map(log.map((entry) => [entry.hash, entry]))
  let nextColorIndex = 0
  const takeNextColor = (): string => {
    const color = GIT_GRAPH_LANE_COLORS[nextColorIndex % GIT_GRAPH_LANE_COLORS.length]
    nextColorIndex += 1
    return color
  }

  let inputLanes: readonly GitGraphLane[] = []
  return log.map((entry) => {
    const matchedLane = inputLanes.find((lane) => lane.id === entry.hash)
    const circleLane = matchedLane ? inputLanes.indexOf(matchedLane) : inputLanes.length
    const circleColor = getRefColor(entry, upstream) ?? matchedLane?.color ?? takeNextColor()

    const outputLanes = continueInputLanes(inputLanes, entry, circleLane, circleColor)

    // 親ごとの、線を引く出力レーンの位置
    const parentLanes: number[] = []
    const firstParent = entry.parents.at(0)
    if (firstParent !== undefined) {
      if (!matchedLane) outputLanes.push({ id: firstParent, color: circleColor, sourceLane: null })
      parentLanes.push(matchedLane ? circleLane : outputLanes.length - 1)
    }
    for (const parent of entry.parents.slice(1)) {
      const existingLane = outputLanes.map((lane) => lane.id).lastIndexOf(parent)
      if (existingLane !== -1) {
        parentLanes.push(existingLane)
        continue
      }
      const loadedParent = entriesByHash.get(parent)
      const refColor = loadedParent ? getRefColor(loadedParent, upstream) : null
      outputLanes.push({ id: parent, color: refColor ?? takeNextColor(), sourceLane: null })
      parentLanes.push(outputLanes.length - 1)
    }

    const row: GitGraphRow = {
      entry,
      circleLane,
      circleColor,
      segments: [
        ...buildIncomingSegments(inputLanes, outputLanes, entry, circleLane),
        ...parentLanes.map(
          (toLane): GitGraphSegment => ({
            kind: 'fromCircle',
            fromLane: circleLane,
            toLane,
            color: outputLanes[toLane].color
          })
        )
      ],
      laneCount: Math.max(inputLanes.length, outputLanes.length, circleLane + 1)
    }
    inputLanes = outputLanes
    return row
  })
}
