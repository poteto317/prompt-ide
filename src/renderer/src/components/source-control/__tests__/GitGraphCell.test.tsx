import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import type { GitLogEntry } from '@shared/types'
import type { GitGraphRow, GitGraphSegment } from '../../../lib/gitGraph'
import GitGraphCell from '../GitGraphCell'

const makeRow = (
  overrides: Partial<GitGraphRow> = {},
  entry: Partial<GitLogEntry> = {}
): GitGraphRow => ({
  entry: {
    hash: 'a'.repeat(40),
    parents: ['b'.repeat(40)],
    refs: [],
    isHead: false,
    message: 'feat: x',
    date: '2026-09-03T10:00:00+09:00',
    authorName: 'Alice',
    ...entry
  },
  circleLane: 0,
  circleColor: '#FFB000',
  segments: [],
  laneCount: 1,
  ...overrides
})

const renderSvg = (row: GitGraphRow): SVGSVGElement => {
  const { container } = render(<GitGraphCell row={row} />)
  return container.querySelector('svg') as SVGSVGElement
}

const segment = (overrides: Partial<GitGraphSegment>): GitGraphSegment => ({
  kind: 'through',
  fromLane: 0,
  toLane: 0,
  color: '#40B0A6',
  ...overrides
})

describe('GitGraphCell', () => {
  it('SVG は aria-hidden で、高さは 22、幅はレーン数 × 11', () => {
    const svg = renderSvg(makeRow({ laneCount: 3 }))
    expect(svg).toHaveAttribute('aria-hidden', 'true')
    expect(svg).toHaveAttribute('height', '22')
    expect(svg).toHaveAttribute('width', '33')
  })

  // viewBox があると、max-width で幅が縮んだときに切れず全体が縮小される(要件 14 は「超えた分は切る」)
  it('viewBox を持たない(幅の上限を超えた分は縮小されず切れる)', () => {
    expect(renderSvg(makeRow({ laneCount: 8 }))).not.toHaveAttribute('viewBox')
  })

  it('線の種類ごとの経路を、レーンの中心の x で引く', () => {
    const svg = renderSvg(
      makeRow({
        laneCount: 3,
        segments: [
          segment({ kind: 'through', fromLane: 2, toLane: 1 }),
          segment({ kind: 'toCircle', fromLane: 1, toLane: 0 }),
          segment({ kind: 'fromCircle', fromLane: 0, toLane: 2 })
        ]
      })
    )
    expect(Array.from(svg.querySelectorAll('path')).map((path) => path.getAttribute('d'))).toEqual([
      'M 27.5 0 C 27.5 11, 16.5 11, 16.5 22',
      'M 16.5 0 C 16.5 5.5, 5.5 5.5, 5.5 11',
      'M 5.5 11 C 5.5 16.5, 27.5 16.5, 27.5 22'
    ])
  })

  it('線の本数は segments と同じで、色と太さ 1.5 で塗らずに引く', () => {
    const svg = renderSvg(
      makeRow({
        segments: [segment({ color: '#40B0A6' }), segment({ kind: 'fromCircle', color: '#B66DFF' })]
      })
    )
    const paths = Array.from(svg.querySelectorAll('path'))
    expect(paths).toHaveLength(2)
    expect(paths.map((path) => path.getAttribute('stroke'))).toEqual(['#40B0A6', '#B66DFF'])
    paths.forEach((path) => {
      expect(path).toHaveAttribute('stroke-width', '1.5')
      expect(path).toHaveAttribute('fill', 'none')
    })
  })

  it('円は線より後に描き、線の上に重なる', () => {
    const svg = renderSvg(makeRow({ segments: [segment({ kind: 'toCircle' })] }))
    expect(svg.lastElementChild?.tagName).toBe('circle')
  })

  it('通常のコミットは塗りつぶしの円 1 つ(半径 4、円のレーンの中心)', () => {
    const svg = renderSvg(makeRow({ circleLane: 1, laneCount: 2, circleColor: '#DC267F' }))
    const circles = svg.querySelectorAll('circle')
    expect(circles).toHaveLength(1)
    expect(circles[0]).toHaveAttribute('cx', '16.5')
    expect(circles[0]).toHaveAttribute('cy', '11')
    expect(circles[0]).toHaveAttribute('r', '4')
    expect(circles[0]).toHaveAttribute('fill', '#DC267F')
  })

  it('HEAD は太い輪 1 つ', () => {
    const svg = renderSvg(makeRow({ circleColor: '#59A4F9' }, { isHead: true }))
    const circles = svg.querySelectorAll('circle')
    expect(circles).toHaveLength(1)
    expect(circles[0]).toHaveAttribute('fill', '#252526')
    expect(circles[0]).toHaveAttribute('stroke', '#59A4F9')
    expect(circles[0]).toHaveAttribute('stroke-width', '2')
  })

  it('マージコミットは輪と内側の小さい円の 2 つ', () => {
    const svg = renderSvg(makeRow({}, { parents: ['b'.repeat(40), 'c'.repeat(40)] }))
    const [ring, inner, ...rest] = Array.from(svg.querySelectorAll('circle'))
    expect(rest).toHaveLength(0)
    expect(ring).toHaveAttribute('fill', '#252526')
    expect(ring).toHaveAttribute('stroke', '#FFB000')
    expect(ring).toHaveAttribute('r', '4')
    expect(inner).toHaveAttribute('fill', '#FFB000')
    expect(Number(inner.getAttribute('r'))).toBeLessThan(4)
  })

  it('HEAD がマージコミットのときは HEAD の太い輪を優先する', () => {
    const svg = renderSvg(
      makeRow(
        { circleColor: '#59A4F9' },
        { isHead: true, parents: ['b'.repeat(40), 'c'.repeat(40)] }
      )
    )
    const circles = svg.querySelectorAll('circle')
    expect(circles).toHaveLength(1)
    expect(circles[0]).toHaveAttribute('stroke-width', '2')
  })

  it('親が無いルートコミットは通常の円', () => {
    const svg = renderSvg(makeRow({}, { parents: [] }))
    expect(svg.querySelectorAll('circle')).toHaveLength(1)
    expect(svg.querySelector('circle')).toHaveAttribute('fill', '#FFB000')
  })
})
