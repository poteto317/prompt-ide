import { describe, it, expect } from 'vitest'
import type { AgentChangesView } from '../../types'
import {
  buildAgentChangesHeading,
  buildAgentChangesRunHeading,
  describeAgentChangesAttribution,
  describeAgentChangesScopeUnavailable,
  formatAgentChangesExcludedNote
} from '../agentChangesMessages'
import {
  agentChangesReasonTargets,
  buildAgentChangesSectionHeading,
  describeAgentChangesListUnavailable,
  describeAgentChangesSectionAttribution,
  describeAgentChangesSectionExcluded
} from '../agentChangesSectionText'
import {
  makeAgentChangeEntry,
  makeAgentChangesLostSummary,
  makeAgentChangesRecordingView,
  makeAgentChangesRun,
  makeAgentChangesScopeUnavailableView
} from '../../__tests__/makeAgentChangesState'

const failedRun = makeAgentChangesRun({
  runId: 2,
  number: 2,
  availability: { kind: 'start-not-recorded', reason: 'timeout' }
})
const run1 = makeAgentChangesRun({ runId: 1, number: 1, endedAt: 200 })
const unavailableView = (
  reason: 'run-missing' | 'start-not-recorded' | 'end-not-recorded',
  runId: number
): AgentChangesView =>
  makeAgentChangesScopeUnavailableView({ kind: 'run', runId }, reason, { runs: [run1, failedRun] })

describe('buildAgentChangesSectionHeading', () => {
  it('記録が無ければ件数も時刻も無い見出し', () => {
    expect(buildAgentChangesSectionHeading({ kind: 'none' }, { kind: 'all' })).toBe(
      buildAgentChangesHeading(null)
    )
  })

  it('累積は始点の時刻と、取れた一覧の件数を添える', () => {
    const view = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], {
      startedAt: 100,
      totalCount: 3
    })
    expect(buildAgentChangesSectionHeading(view, { kind: 'all' })).toBe(
      buildAgentChangesHeading({ startedAt: 100, totalCount: 3 })
    )
  })

  it('選んでいる実行が写しにあれば、実行の番号と期間を添える(一覧を取る前は件数なし)', () => {
    const view = makeAgentChangesRecordingView(null, { runs: [run1] })
    expect(buildAgentChangesSectionHeading(view, { kind: 'run', runId: 1 })).toBe(
      buildAgentChangesRunHeading(run1, null)
    )
  })

  it('選んでいる実行が写しに無ければ、累積の見出しにする', () => {
    const view = makeAgentChangesRecordingView([], { startedAt: 100, runs: [run1] })
    expect(buildAgentChangesSectionHeading(view, { kind: 'run', runId: 9 })).toBe(
      buildAgentChangesHeading({ startedAt: 100, totalCount: 0 })
    )
  })
})

describe('describeAgentChangesListUnavailable', () => {
  it('記録なし・一覧が取れているときは null', () => {
    expect(describeAgentChangesListUnavailable({ kind: 'none' })).toBeNull()
    expect(describeAgentChangesListUnavailable(makeAgentChangesRecordingView([]))).toBeNull()
    expect(describeAgentChangesListUnavailable(makeAgentChangesRecordingView(null))).toBeNull()
  })

  it('run-missing は出さない(累積に戻して取り直すため)', () => {
    expect(describeAgentChangesListUnavailable(unavailableView('run-missing', 9))).toBeNull()
  })

  it('開始を取れなかった実行は、写しの実行の理由を添える', () => {
    expect(describeAgentChangesListUnavailable(unavailableView('start-not-recorded', 2))).toBe(
      describeAgentChangesScopeUnavailable('start-not-recorded', failedRun)
    )
  })

  it('終わりを取れなかった実行は、その理由', () => {
    expect(describeAgentChangesListUnavailable(unavailableView('end-not-recorded', 1))).toBe(
      describeAgentChangesScopeUnavailable('end-not-recorded', run1)
    )
  })
})

describe('describeAgentChangesSectionAttribution(区別の状態の 1 行を出す条件)', () => {
  // 出す文言がある区別の要約(区別を始める前の tracking は文言が無いため、出す条件の検査に使わない)
  const attribution = makeAgentChangesLostSummary()
  const expected = describeAgentChangesAttribution(attribution, 100)

  it('累積の範囲で、累積の一覧(取り直す前を含む)なら区別の要約の文言を出す', () => {
    const listed = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], { attribution })
    const loading = makeAgentChangesRecordingView(null, { attribution })
    expect(expected).not.toBeNull()
    expect(describeAgentChangesSectionAttribution(listed, { kind: 'all' })).toBe(expected)
    expect(describeAgentChangesSectionAttribution(loading, { kind: 'all' })).toBe(expected)
  })

  it('選んでいる範囲が実行なら出さない', () => {
    const view = makeAgentChangesRecordingView(null, { attribution })
    expect(describeAgentChangesSectionAttribution(view, { kind: 'run', runId: 1 })).toBeNull()
  })

  it('表示中の一覧が実行の範囲なら(累積を選んだ直後でも)出さない', () => {
    const view = makeAgentChangesRecordingView([], {
      attribution,
      scope: { kind: 'run', runId: 1 }
    })
    expect(describeAgentChangesSectionAttribution(view, { kind: 'all' })).toBeNull()
  })

  it('記録中でなければ出さない', () => {
    expect(describeAgentChangesSectionAttribution({ kind: 'none' }, { kind: 'all' })).toBeNull()
  })
})

describe('describeAgentChangesSectionExcluded(すべて戻すから除く旨を出す条件)', () => {
  const entries = [makeAgentChangeEntry('a.txt', { author: 'user' })]

  it('累積の一覧に行があり、除く件数が 1 以上なら除く旨を出す', () => {
    const view = makeAgentChangesRecordingView(entries)
    expect(describeAgentChangesSectionExcluded(view, 1)).toBe(formatAgentChangesExcludedNote(1))
  })

  it('除く件数が 0 なら出さない', () => {
    expect(
      describeAgentChangesSectionExcluded(makeAgentChangesRecordingView(entries), 0)
    ).toBeNull()
  })

  it.each([
    ['一覧を取り直す前', makeAgentChangesRecordingView(null)],
    ['行が 0 件', makeAgentChangesRecordingView([])],
    [
      '実行の範囲の一覧',
      makeAgentChangesRecordingView(entries, { scope: { kind: 'run', runId: 1 } })
    ],
    ['記録なし', { kind: 'none' } as const]
  ])('%s なら出さない', (_, view) => {
    expect(describeAgentChangesSectionExcluded(view, 1)).toBeNull()
  })
})

describe('agentChangesReasonTargets', () => {
  const flags = [false, true]
  const combinations = flags.flatMap((isWriting) =>
    flags.flatMap((hasListReason) =>
      flags.map((hasUndoBand) => ({ isWriting, hasListReason, hasUndoBand }))
    )
  )

  it.each(combinations)(
    '実行中は範囲の選択・確認を終えるが必ず理由を結び、その要素が出ている: %o',
    (input) => {
      const targets = agentChangesReasonTargets(input)
      if (!input.isWriting) {
        expect(targets.clear).toBeNull()
        expect(targets.showSectionUndoReason).toBe(false)
        expect(targets.scopeSelect).toBe(input.hasListReason ? 'list' : null)
        return
      }
      expect(targets.scopeSelect).toBe(targets.clear)
      // 結ぶ要素が画面にある: 一覧の上の理由、帯の理由、またはセクションに出す取り消しの理由
      if (targets.clear === 'list') expect(input.hasListReason).toBe(true)
      else {
        expect(targets.clear).toBe('undo')
        expect(input.hasUndoBand || targets.showSectionUndoReason).toBe(true)
      }
    }
  )

  it('一覧の上の理由があればそれを優先し、帯が消えて一覧の理由も無いときだけセクションに理由を出す', () => {
    expect(
      agentChangesReasonTargets({ isWriting: true, hasListReason: true, hasUndoBand: true })
    ).toEqual({ scopeSelect: 'list', clear: 'list', showSectionUndoReason: false })
    expect(
      agentChangesReasonTargets({ isWriting: true, hasListReason: false, hasUndoBand: true })
    ).toEqual({ scopeSelect: 'undo', clear: 'undo', showSectionUndoReason: false })
    expect(
      agentChangesReasonTargets({ isWriting: true, hasListReason: false, hasUndoBand: false })
    ).toEqual({ scopeSelect: 'undo', clear: 'undo', showSectionUndoReason: true })
  })
})
