import { describe, it, expect } from 'vitest'
import type { GitLogEntry, GitLogRef } from '@shared/types'
import {
  buildGitGraphRows,
  GIT_GRAPH_HEAD_COLOR,
  GIT_GRAPH_LANE_COLORS,
  GIT_GRAPH_UPSTREAM_COLOR
} from '../gitGraph'
import type { GitGraphRow, GitGraphSegment } from '../gitGraph'

const [C0, C1, C2, C3, C4] = GIT_GRAPH_LANE_COLORS

function commit(
  hash: string,
  parents: string[] = [],
  overrides: Partial<GitLogEntry> = {}
): GitLogEntry {
  return {
    hash,
    parents,
    refs: [],
    isHead: false,
    message: hash,
    date: '2026-10-30T00:00:00+09:00',
    authorName: 'tester',
    ...overrides
  }
}

function remoteRef(name: string): GitLogRef {
  return { kind: 'remote', name }
}

function segment(
  kind: GitGraphSegment['kind'],
  fromLane: number,
  toLane: number,
  color: string
): GitGraphSegment {
  return { kind, fromLane, toLane, color }
}

function sortedSegments(segments: readonly GitGraphSegment[]): string[] {
  return segments.map((s) => JSON.stringify(s)).sort()
}

function expectSegments(row: GitGraphRow, expected: GitGraphSegment[]): void {
  expect(sortedSegments(row.segments)).toEqual(sortedSegments(expected))
}

function range(length: number): number[] {
  return Array.from({ length }, (_, index) => index)
}

function byNumber(a: number, b: number): number {
  return a - b
}

// 行の下端の線を、レーンごとの色にまとめる(同じレーンへ入る線は同じ色でなければならない)
function collectOutputLaneColors(row: GitGraphRow): Map<number, string> {
  const colors = new Map<number, string>()
  for (const s of row.segments) {
    if (s.kind === 'toCircle') continue
    const known = colors.get(s.toLane)
    if (known !== undefined) expect(s.color).toBe(known)
    colors.set(s.toLane, s.color)
  }
  return colors
}

// row の下端のレーンから線を辿り、行き着いた円のハッシュを返す。一覧の下端まで伸びる線は null
function traceLineToCircle(
  rows: readonly GitGraphRow[],
  rowIndex: number,
  lane: number
): string | null {
  let current = lane
  for (const row of rows.slice(rowIndex + 1)) {
    const incoming = row.segments.find((s) => s.kind !== 'fromCircle' && s.fromLane === current)
    if (incoming === undefined)
      throw new Error(`レーン ${current} の線が ${row.entry.hash} で切れた`)
    if (incoming.kind === 'toCircle') return row.entry.hash
    current = incoming.toLane
  }
  return null
}

// 全テストで使う共通の検査。行の間で線が切れていないことと、線が親の円に着くことを確かめる
function expectLinesConnected(rows: readonly GitGraphRow[]): void {
  const loadedHashes = new Set(rows.map((row) => row.entry.hash))
  let previousOutput = new Map<number, string>()

  rows.forEach((row, rowIndex) => {
    const top = row.segments.filter((s) => s.kind !== 'fromCircle')

    // 各行の上端に、前の行の出力レーンのすべてから線が 1 本ずつ来る
    expect(top.map((s) => s.fromLane).sort(byNumber)).toEqual(range(previousOutput.size))
    for (const s of top) expect(s.color).toBe(previousOutput.get(s.fromLane))

    // 各行の下端の出力レーンのすべてに線が入り、レーンに隙間が無い
    const output = collectOutputLaneColors(row)
    expect([...output.keys()].sort(byNumber)).toEqual(range(output.size))

    // 円へ入る線と円から出る線は、円のレーンにつながる
    for (const s of row.segments) {
      if (s.kind === 'toCircle') expect(s.toLane).toBe(row.circleLane)
      if (s.kind === 'fromCircle') expect(s.fromLane).toBe(row.circleLane)
    }
    // 入ってくる線が無い円は、新しいレーンとして末尾に置かれる
    if (!top.some((s) => s.kind === 'toCircle')) expect(row.circleLane).toBe(previousOutput.size)

    // 描画の幅は、円とすべての線を含む
    const usedLanes = row.segments.flatMap((s) => [s.fromLane, s.toLane])
    expect(row.laneCount).toBe(Math.max(row.circleLane, ...usedLanes) + 1)

    // 円から出る線は親の円に着く。未読み込みの親へ向かう線は下端まで伸びる
    const reached = row.segments
      .filter((s) => s.kind === 'fromCircle')
      .map((s) => String(traceLineToCircle(rows, rowIndex, s.toLane)))
    const expected = row.entry.parents.map((p) => (loadedHashes.has(p) ? p : 'null'))
    expect(reached.sort()).toEqual(expected.sort())

    previousOutput = output
  })
}

function buildRows(log: GitLogEntry[], upstream: string | null = null): GitGraphRow[] {
  const rows = buildGitGraphRows(log, upstream)
  expectLinesConnected(rows)
  return rows
}

// シードを固定した乱数(mulberry32)。失敗を再現できるようにする
function createRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// 親が必ず後ろに来る並び(--topo-order と同じ条件)の乱数の DAG を作る
function randomLog(random: () => number, size: number): GitLogEntry[] {
  const hashes = range(size).map((index) => `c${index}`)
  const entries = hashes.map((hash, index) => {
    const parentCount = Math.floor(random() * 4)
    const later = hashes.slice(index + 1)
    const parents: string[] = []
    while (parents.length < parentCount && later.length > 0) {
      const [picked] = later.splice(Math.floor(random() * later.length), 1)
      parents.push(picked)
    }
    return commit(hash, parents)
  })
  const headIndex = Math.floor(random() * size)
  const upstreamIndex = Math.floor(random() * size)
  entries[upstreamIndex] = { ...entries[upstreamIndex], refs: [remoteRef('origin/main')] }
  entries[headIndex] = { ...entries[headIndex], isHead: true }
  return entries
}

describe('定数', () => {
  it('VS Code の既定の色を使う', () => {
    expect(GIT_GRAPH_LANE_COLORS).toEqual(['#FFB000', '#DC267F', '#994F00', '#40B0A6', '#B66DFF'])
    expect(GIT_GRAPH_HEAD_COLOR).toBe('#59A4F9')
    expect(GIT_GRAPH_UPSTREAM_COLOR).toBe('#B180D7')
  })
})

describe('buildGitGraphRows: 線の組み立て', () => {
  it('空の履歴は空の行を返す', () => {
    expect(buildRows([])).toEqual([])
  })

  it('直線は 1 本のレーンでつながる', () => {
    const rows = buildRows([commit('C', ['B']), commit('B', ['A']), commit('A')])

    expect(rows.map((row) => row.circleLane)).toEqual([0, 0, 0])
    expect(rows.map((row) => row.circleColor)).toEqual([C0, C0, C0])
    expect(rows.map((row) => row.laneCount)).toEqual([1, 1, 1])
    expectSegments(rows[0], [segment('fromCircle', 0, 0, C0)])
    expectSegments(rows[1], [segment('toCircle', 0, 0, C0), segment('fromCircle', 0, 0, C0)])
    expectSegments(rows[2], [segment('toCircle', 0, 0, C0)])
  })

  it('各行の entry に元のコミットを持つ', () => {
    const log = [commit('B', ['A']), commit('A')]

    expect(buildRows(log).map((row) => row.entry)).toEqual(log)
  })

  it('分岐は新しいレーンを末尾に足し、親で合流する', () => {
    const rows = buildRows([commit('X', ['A']), commit('Y', ['A']), commit('A')])

    expect(rows.map((row) => row.circleLane)).toEqual([0, 1, 0])
    expect(rows.map((row) => row.circleColor)).toEqual([C0, C1, C0])
    expect(rows.map((row) => row.laneCount)).toEqual([1, 2, 2])
    expectSegments(rows[1], [segment('through', 0, 0, C0), segment('fromCircle', 1, 1, C1)])
    expectSegments(rows[2], [segment('toCircle', 0, 0, C0), segment('toCircle', 1, 0, C1)])
  })

  it('マージは第 2 親のレーンを末尾に足し、親で合流する', () => {
    const rows = buildRows([commit('M', ['A', 'B']), commit('B', ['A']), commit('A')])

    expect(rows.map((row) => row.circleLane)).toEqual([0, 1, 0])
    expectSegments(rows[0], [segment('fromCircle', 0, 0, C0), segment('fromCircle', 0, 1, C1)])
    expectSegments(rows[1], [
      segment('through', 0, 0, C0),
      segment('toCircle', 1, 1, C1),
      segment('fromCircle', 1, 1, C1)
    ])
    expectSegments(rows[2], [segment('toCircle', 0, 0, C0), segment('toCircle', 1, 0, C1)])
  })

  it('第 2 親の線は、同じ親のレーンが複数あれば最後の 1 本へ引く', () => {
    const rows = buildRows([
      commit('X', ['B']),
      commit('Y', ['B']),
      commit('M', ['A', 'B']),
      commit('B', ['A']),
      commit('A')
    ])

    expect(rows[2].circleLane).toBe(2)
    expectSegments(rows[2], [
      segment('through', 0, 0, C0),
      segment('through', 1, 1, C1),
      segment('fromCircle', 2, 2, C2),
      segment('fromCircle', 2, 1, C1)
    ])
  })

  it('タコマージは親ごとにレーンを足す', () => {
    const rows = buildRows([
      commit('O', ['P', 'Q', 'R']),
      commit('P', ['Z']),
      commit('Q', ['Z']),
      commit('R', ['Z']),
      commit('Z')
    ])

    expect(rows[0].laneCount).toBe(3)
    expectSegments(rows[0], [
      segment('fromCircle', 0, 0, C0),
      segment('fromCircle', 0, 1, C1),
      segment('fromCircle', 0, 2, C2)
    ])
  })

  it('同じ親への 3 本は親の行で 1 つの円へ合流する', () => {
    const rows = buildRows([
      commit('O', ['P', 'Q', 'R']),
      commit('P', ['Z']),
      commit('Q', ['Z']),
      commit('R', ['Z']),
      commit('Z', ['Y']),
      commit('Y')
    ])

    expect(rows[4].circleLane).toBe(0)
    expect(rows[4].laneCount).toBe(3)
    expectSegments(rows[4], [
      segment('toCircle', 0, 0, C0),
      segment('toCircle', 1, 0, C1),
      segment('toCircle', 2, 0, C2),
      segment('fromCircle', 0, 0, C0)
    ])
    expect(rows[5].laneCount).toBe(1)
  })

  it('同じ親を持つレーンの間でも、線は位置で対応する(設計書の例)', () => {
    const rows = buildRows([
      commit('M', ['B', 'F']),
      commit('F', ['A']),
      commit('B', ['A']),
      commit('A', ['R'])
    ])

    expectSegments(rows[2], [
      segment('through', 1, 1, C1),
      segment('toCircle', 0, 0, C0),
      segment('fromCircle', 0, 0, C0)
    ])
    expectSegments(rows[3], [
      segment('toCircle', 0, 0, C0),
      segment('toCircle', 1, 0, C1),
      segment('fromCircle', 0, 0, C0)
    ])
  })

  it('合流で詰まったレーンは、素通りの線で元の位置から新しい位置へ移る', () => {
    const rows = buildRows([
      commit('T1', ['P']),
      commit('T2', ['P']),
      commit('T3', ['Q']),
      commit('P', ['A']),
      commit('Q', ['A']),
      commit('A')
    ])

    expectSegments(rows[3], [
      segment('toCircle', 0, 0, C0),
      segment('toCircle', 1, 0, C1),
      segment('fromCircle', 0, 0, C0),
      segment('through', 2, 1, C2)
    ])
  })

  it('親が既存のレーンと同じ新しいコミットは、別のレーンとして末尾に足す', () => {
    const rows = buildRows([
      commit('X', ['A']),
      commit('Y', ['A']),
      commit('B', ['A']),
      commit('A')
    ])

    expectSegments(rows[2], [
      segment('through', 0, 0, C0),
      segment('through', 1, 1, C1),
      segment('fromCircle', 2, 2, C2)
    ])
  })

  it('ルートの行では一致したレーンが消え、右のレーンが詰まる', () => {
    const rows = buildRows([commit('X', ['R']), commit('Y', ['Z']), commit('R'), commit('Z')])

    expectSegments(rows[2], [segment('toCircle', 0, 0, C0), segment('through', 1, 0, C1)])
    expect(rows[3].circleLane).toBe(0)
  })

  it('線の入らないルートは入力レーンの末尾に置き、線を出さない', () => {
    const rows = buildRows([commit('T', ['A']), commit('R'), commit('A')])

    expect(rows[1].circleLane).toBe(1)
    expect(rows[1].circleColor).toBe(C1)
    expect(rows[1].laneCount).toBe(2)
    expectSegments(rows[1], [segment('through', 0, 0, C0)])
  })

  it('コミットが 1 つだけのルートは線を持たない', () => {
    const rows = buildRows([commit('A')])

    expect(rows[0].circleLane).toBe(0)
    expect(rows[0].laneCount).toBe(1)
    expect(rows[0].segments).toEqual([])
  })

  it('未読み込みの親へ向かうレーンは一覧の下端まで伸びる', () => {
    const rows = buildRows([commit('T', ['U1']), commit('S', ['U2'])])

    expectSegments(rows[1], [segment('through', 0, 0, C0), segment('fromCircle', 1, 1, C1)])
  })

  it('未読み込みの第 2 親のレーンも下端まで伸びる', () => {
    const rows = buildRows([commit('M', ['A', 'U']), commit('A')])

    expectSegments(rows[1], [segment('toCircle', 0, 0, C0), segment('through', 1, 0, C1)])
  })

  it('入力の配列を書き換えない', () => {
    const log = [commit('M', ['A', 'B']), commit('B', ['A']), commit('A')]
    const snapshot = structuredClone(log)

    buildRows(log)

    expect(log).toEqual(snapshot)
  })
})

describe('buildGitGraphRows: 色', () => {
  it('5 色を順に使い、6 色目で先頭に戻る', () => {
    const rows = buildRows([
      commit('O', ['P0', 'P1', 'P2', 'P3', 'P4', 'P5']),
      ...['P0', 'P1', 'P2', 'P3', 'P4', 'P5'].map((hash) => commit(hash))
    ])

    expect(rows.slice(1).map((row) => row.circleColor)).toEqual([C0, C1, C2, C3, C4, C0])
  })

  it('HEAD の円と、そこから下のレーンは HEAD の色になる', () => {
    const rows = buildRows([commit('H', ['A'], { isHead: true }), commit('A')])

    expect(rows[0].circleColor).toBe(GIT_GRAPH_HEAD_COLOR)
    expectSegments(rows[0], [segment('fromCircle', 0, 0, GIT_GRAPH_HEAD_COLOR)])
    expect(rows[1].circleColor).toBe(GIT_GRAPH_HEAD_COLOR)
  })

  it('上流の円と、そこから下のレーンは上流の色になる', () => {
    const rows = buildRows(
      [commit('U', ['A'], { refs: [remoteRef('origin/main')] }), commit('A')],
      'origin/main'
    )

    expect(rows[0].circleColor).toBe(GIT_GRAPH_UPSTREAM_COLOR)
    expect(rows[1].circleColor).toBe(GIT_GRAPH_UPSTREAM_COLOR)
  })

  it('色の付いたコミットで止まると、入ってくる線は元の色、出ていく線は新しい色になる', () => {
    const rows = buildRows([commit('T', ['H']), commit('H', ['A'], { isHead: true }), commit('A')])

    expect(rows[1].circleColor).toBe(GIT_GRAPH_HEAD_COLOR)
    expectSegments(rows[1], [
      segment('toCircle', 0, 0, C0),
      segment('fromCircle', 0, 0, GIT_GRAPH_HEAD_COLOR)
    ])
  })

  it('上流が HEAD より先行していると、上流の線が HEAD で HEAD の色に変わる', () => {
    const rows = buildRows(
      [
        commit('U', ['H'], { refs: [remoteRef('origin/main')] }),
        commit('H', ['A'], { isHead: true }),
        commit('A')
      ],
      'origin/main'
    )

    expect(rows.map((row) => row.circleColor)).toEqual([
      GIT_GRAPH_UPSTREAM_COLOR,
      GIT_GRAPH_HEAD_COLOR,
      GIT_GRAPH_HEAD_COLOR
    ])
    expectSegments(rows[1], [
      segment('toCircle', 0, 0, GIT_GRAPH_UPSTREAM_COLOR),
      segment('fromCircle', 0, 0, GIT_GRAPH_HEAD_COLOR)
    ])
  })

  it('HEAD と上流が分岐していると、それぞれのレーンの色になる', () => {
    const rows = buildRows(
      [
        commit('H', ['B'], { isHead: true }),
        commit('U', ['B'], { refs: [remoteRef('origin/main')] }),
        commit('B')
      ],
      'origin/main'
    )

    expect(rows[0].circleColor).toBe(GIT_GRAPH_HEAD_COLOR)
    expect(rows[1].circleColor).toBe(GIT_GRAPH_UPSTREAM_COLOR)
    expectSegments(rows[2], [
      segment('toCircle', 0, 0, GIT_GRAPH_HEAD_COLOR),
      segment('toCircle', 1, 0, GIT_GRAPH_UPSTREAM_COLOR)
    ])
  })

  it('HEAD と上流が同じコミットなら HEAD の色を優先する', () => {
    const rows = buildRows(
      [commit('H', [], { isHead: true, refs: [remoteRef('origin/main')] })],
      'origin/main'
    )

    expect(rows[0].circleColor).toBe(GIT_GRAPH_HEAD_COLOR)
  })

  it('ローカルの上流も、ref の種類を問わず上流の色になる', () => {
    const rows = buildRows(
      [
        commit('H', ['U'], { isHead: true }),
        commit('U', [], { refs: [{ kind: 'branch', name: 'develop' }] })
      ],
      'develop'
    )

    expect(rows[1].circleColor).toBe(GIT_GRAPH_UPSTREAM_COLOR)
  })

  it('上流の名前と一致しない ref は上流の色にならない', () => {
    const rows = buildRows([commit('A', [], { refs: [remoteRef('origin/other')] })], 'origin/main')

    expect(rows[0].circleColor).toBe(C0)
  })

  it('上流が null なら ref があっても上流の色にならない', () => {
    const rows = buildRows([commit('A', [], { refs: [remoteRef('origin/main')] })], null)

    expect(rows[0].circleColor).toBe(C0)
  })

  it('色の付いたコミットの円は 5 色を消費しない', () => {
    const rows = buildRows([commit('H', [], { isHead: true }), commit('A')])

    expect(rows[1].circleColor).toBe(C0)
  })

  it('読み込み済みの第 2 親が上流なら、第 2 親のレーンは上流の色になる', () => {
    const rows = buildRows(
      [
        commit('M', ['A', 'U'], { isHead: true }),
        commit('U', ['A'], { refs: [remoteRef('origin/main')] }),
        commit('A')
      ],
      'origin/main'
    )

    expectSegments(rows[0], [
      segment('fromCircle', 0, 0, GIT_GRAPH_HEAD_COLOR),
      segment('fromCircle', 0, 1, GIT_GRAPH_UPSTREAM_COLOR)
    ])
  })

  it('第 2 親の線が既存のレーンへ入るときは、そのレーンの色になり 5 色を消費しない', () => {
    const rows = buildRows([
      commit('X', ['B']),
      commit('M', ['A', 'B']),
      commit('B', ['A']),
      commit('N', ['A']),
      commit('A')
    ])

    expectSegments(rows[1], [
      segment('through', 0, 0, C0),
      segment('fromCircle', 1, 1, C1),
      segment('fromCircle', 1, 0, C0)
    ])
    expect(rows[3].circleColor).toBe(C2)
  })
})

describe('buildGitGraphRows: 乱数の DAG', () => {
  it('どの DAG でも線が切れない', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = createRandom(seed)
      const log = randomLog(random, 2 + Math.floor(random() * 60))
      const rows = buildGitGraphRows(log, 'origin/main')

      expectLinesConnected(rows)
    }
  })

  it('途中までしか読み込んでいなくても線が切れない', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const random = createRandom(seed)
      const log = randomLog(random, 40)
      const loaded = log.slice(0, 1 + Math.floor(random() * log.length))
      const rows = buildGitGraphRows(loaded, 'origin/main')

      expectLinesConnected(rows)
    }
  })
})
