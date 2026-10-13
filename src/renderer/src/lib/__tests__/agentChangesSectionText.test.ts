import { describe, it, expect } from 'vitest'
import type { AgentChangesView } from '../../types'
import {
  buildAgentChangesHeading,
  buildAgentChangesRunHeading,
  describeAgentChangesScopeUnavailable
} from '../agentChangesMessages'
import {
  agentChangesReasonTargets,
  buildAgentChangesSectionHeading,
  describeAgentChangesListUnavailable
} from '../agentChangesSectionText'
import {
  makeAgentChangeEntry,
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
