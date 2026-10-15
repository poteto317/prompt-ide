import { describe, it, expect } from 'vitest'
import type { AgentChangesState } from '@shared/types'
import {
  isSameAgentChangesRecording,
  isSameAgentChangesView,
  planListResult,
  planRecordingState,
  recordingStartedAtOf
} from '../agentChangesView'
import {
  makeAgentChangeEntry,
  makeAgentChangesListResult,
  makeAgentChangesLostSummary,
  makeAgentChangesRecordingState,
  makeAgentChangesRecordingView,
  makeAgentChangesRun,
  makeAgentChangesScopeUnavailableListResult,
  makeAgentChangesTrackingSummary,
  makeAgentChangesUndoSummary
} from '../../__tests__/makeAgentChangesState'

const run1 = makeAgentChangesRun({ runId: 1, number: 1 })
const run2 = makeAgentChangesRun({ runId: 2, number: 2 })
const recordingState = (
  startedAt: number,
  runs = [run1, run2]
): Extract<AgentChangesState, { kind: 'recording' }> =>
  makeAgentChangesRecordingState({ startedAt, runs })

describe('recordingStartedAtOf', () => {
  it('記録中なら記録の始点の時刻を返す', () => {
    expect(recordingStartedAtOf(makeAgentChangesRecordingView(null, { startedAt: 100 }))).toBe(100)
  })

  it('記録中でなければ null を返す', () => {
    expect(recordingStartedAtOf({ kind: 'none' })).toBeNull()
    expect(
      recordingStartedAtOf({
        kind: 'unavailable',
        state: { kind: 'unavailable', reason: 'git-failed' }
      })
    ).toBeNull()
  })
})

describe('isSameAgentChangesRecording', () => {
  it('記録中で始点の時刻が同じなら同じ記録', () => {
    expect(
      isSameAgentChangesRecording(makeAgentChangesRecordingView(null, { startedAt: 100 }), 100)
    ).toBe(true)
  })

  it('始点の時刻が違えば別の記録(実行の一覧・一覧の有無は見ない)', () => {
    const view = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], {
      startedAt: 100,
      runs: [run1]
    })
    expect(isSameAgentChangesRecording(view, 200)).toBe(false)
  })

  it('記録なし・記録できない写しは、どの記録とも同じではない', () => {
    expect(isSameAgentChangesRecording({ kind: 'none' }, 100)).toBe(false)
    expect(
      isSameAgentChangesRecording(
        { kind: 'unavailable', state: { kind: 'unavailable', reason: 'git-failed' } },
        100
      )
    ).toBe(false)
  })
})

describe('planRecordingState', () => {
  it('同じ記録で選んでいる実行が残っていれば、一覧を残し範囲も変えない', () => {
    const previous = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], {
      runs: [run1, run2],
      scope: { kind: 'run', runId: 2 }
    })
    const plan = planRecordingState(previous, recordingState(100), { kind: 'run', runId: 2 })
    expect(plan.resetScope).toBe(false)
    expect(plan.missingRun).toBeNull()
    expect(plan.view.list).toBe(previous.kind === 'recording' ? previous.list : undefined)
    expect(plan.view.runs).toEqual([run1, run2])
  })

  it('同じ記録で選んでいた実行が消えたら、一覧を空にし、消える前の実行の一覧を添える', () => {
    const previous = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], {
      runs: [run1, run2]
    })
    const plan = planRecordingState(previous, recordingState(100, [run2]), {
      kind: 'run',
      runId: 1
    })
    expect(plan.view.list).toBeNull()
    expect(plan.missingRun).toEqual({ runId: 1, previousRuns: [run1, run2] })
    expect(plan.resetScope).toBe(false)
  })

  it('別の記録になったら、一覧を空にし、実行を選んでいれば範囲を累積に戻す(消えた読み上げはしない)', () => {
    const previous = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
    const plan = planRecordingState(previous, recordingState(999), { kind: 'run', runId: 1 })
    expect(plan.view).toEqual({
      kind: 'recording',
      startedAt: 999,
      runs: [run1, run2],
      list: null,
      undo: null,
      attribution: makeAgentChangesTrackingSummary()
    })
    expect(plan.resetScope).toBe(true)
    expect(plan.missingRun).toBeNull()
  })

  it('記録が無い写しからの反映で累積を選んでいれば、範囲は戻さない', () => {
    const plan = planRecordingState({ kind: 'none' }, recordingState(100), { kind: 'all' })
    expect(plan.resetScope).toBe(false)
    expect(plan.view.list).toBeNull()
  })
})

describe('planListResult', () => {
  // 実行 1 が消えていた(保持の上限で外れた)list の結果。始点 5・残った実行は 2 だけ
  const run1MissingResult = makeAgentChangesScopeUnavailableListResult(
    { kind: 'run', runId: 1 },
    'run-missing',
    { startedAt: 5, runs: [run2] }
  )

  it('none は記録なし', () => {
    expect(planListResult({ kind: 'none' }, { kind: 'none' })).toEqual({ kind: 'none' })
  })

  it('取れた一覧は、取った範囲と組で listed の写しにし、件数を添える', () => {
    const entries = [makeAgentChangeEntry('a.txt')]
    const plan = planListResult(
      makeAgentChangesListResult(entries, {
        startedAt: 5,
        runs: [run1],
        scope: { kind: 'run', runId: 1 },
        totalCount: 7,
        truncated: true,
        headChanged: true
      }),
      { kind: 'none' }
    )
    expect(plan).toEqual({
      kind: 'listed',
      totalCount: 7,
      view: {
        kind: 'recording',
        startedAt: 5,
        runs: [run1],
        list: {
          kind: 'listed',
          scope: { kind: 'run', runId: 1 },
          entries,
          totalCount: 7,
          truncated: true,
          headChanged: true
        },
        undo: null,
        attribution: makeAgentChangesTrackingSummary()
      }
    })
  })

  it('実行が消えていた(run-missing)なら、一覧を空にし、消えた runId と反映する前の写しの実行の一覧を返す', () => {
    const previous = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')], {
      startedAt: 5,
      runs: [run1, run2]
    })
    expect(planListResult(run1MissingResult, previous)).toEqual({
      kind: 'run-missing',
      missingRun: { runId: 1, previousRuns: [run1, run2] },
      view: {
        kind: 'recording',
        startedAt: 5,
        runs: [run2],
        list: null,
        undo: null,
        attribution: makeAgentChangesTrackingSummary()
      }
    })
  })

  it('run-missing で反映する前の写しが記録中でなければ、消える前の実行の一覧は空', () => {
    const plan = planListResult(run1MissingResult, { kind: 'none' })
    expect(plan.kind === 'run-missing' ? plan.missingRun : null).toEqual({
      runId: 1,
      previousRuns: []
    })
  })

  it('run-missing の missingRun は planRecordingState の missingRun と同じ形(hook が同じ手順で扱う)', () => {
    const previous = makeAgentChangesRecordingView(null, { startedAt: 5, runs: [run1, run2] })
    const fromList = planListResult(run1MissingResult, previous)
    const fromState = planRecordingState(previous, recordingState(5, [run2]), {
      kind: 'run',
      runId: 1
    })
    expect(fromList.kind === 'run-missing' ? fromList.missingRun : null).toEqual(
      fromState.missingRun
    )
  })

  it('区切りを取れなかった範囲は、理由を一覧の代わりに持つ', () => {
    expect(
      planListResult(
        makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'end-not-recorded', {
          startedAt: 5,
          runs: [run1]
        }),
        { kind: 'none' }
      )
    ).toEqual({
      kind: 'scope-unavailable',
      view: {
        kind: 'recording',
        startedAt: 5,
        runs: [run1],
        list: {
          kind: 'scope-unavailable',
          scope: { kind: 'run', runId: 1 },
          reason: 'end-not-recorded'
        },
        undo: null,
        attribution: makeAgentChangesTrackingSummary()
      }
    })
  })
})

describe('isSameAgentChangesView', () => {
  const view = (
    entries = [makeAgentChangeEntry('a.txt')],
    overrides: Parameters<typeof makeAgentChangesRecordingView>[1] = {}
  ): ReturnType<typeof makeAgentChangesRecordingView> =>
    makeAgentChangesRecordingView(entries, { runs: [run1], ...overrides })

  it('別のオブジェクトでも、記録・実行・一覧の中身が同じなら同じ', () => {
    expect(isSameAgentChangesView(view(), view())).toBe(true)
    expect(isSameAgentChangesView({ kind: 'none' }, { kind: 'none' })).toBe(true)
  })

  it('行の並び・行の状態・記録していない印・HEAD の帯・実行の一覧・始点・種類のどれかが違えば違う', () => {
    const a = makeAgentChangeEntry('a.txt')
    const b = makeAgentChangeEntry('b.txt')
    expect(isSameAgentChangesView(view([a, b]), view([b, a]))).toBe(false)
    expect(
      isSameAgentChangesView(view(), view([makeAgentChangeEntry('a.txt', { status: 'D' })]))
    ).toBe(false)
    expect(
      isSameAgentChangesView(view(), view([makeAgentChangeEntry('a.txt', { notRecorded: true })]))
    ).toBe(false)
    expect(isSameAgentChangesView(view(), view(undefined, { headChanged: true }))).toBe(false)
    expect(isSameAgentChangesView(view(), view(undefined, { runs: [run1, run2] }))).toBe(false)
    expect(isSameAgentChangesView(view(), view(undefined, { startedAt: 200 }))).toBe(false)
    expect(isSameAgentChangesView(view(), makeAgentChangesRecordingView(null))).toBe(false)
    expect(isSameAgentChangesView(view(), { kind: 'none' })).toBe(false)
  })

  it('行の author・記録の区別の要約が違えば違う(静かな取り直しで印・区別の状態の 1 行の変化を見落とさない。L-423)', () => {
    expect(
      isSameAgentChangesView(view(), view([makeAgentChangeEntry('a.txt', { author: 'user' })]))
    ).toBe(false)
    expect(
      isSameAgentChangesView(
        view(),
        view(undefined, { attribution: makeAgentChangesLostSummary() })
      )
    ).toBe(false)
  })
})

describe('取り消しの控えの写し', () => {
  const summary = makeAgentChangesUndoSummary()

  it('記録中の状態の undo を写しへ写す', () => {
    const previous = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
    const plan = planRecordingState(previous, makeAgentChangesRecordingState({ undo: summary }), {
      kind: 'all'
    })
    expect(plan.view.undo).toBe(summary)
  })

  it('一覧の結果(取れた一覧・範囲の一覧を出せない)の undo を写しへ写す', () => {
    const listed = planListResult(makeAgentChangesListResult([], { undo: summary }), {
      kind: 'none'
    })
    expect(listed.kind === 'listed' ? listed.view.undo : undefined).toBe(summary)
    const unavailable = planListResult(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'end-not-recorded', {
        undo: summary
      }),
      { kind: 'none' }
    )
    expect(unavailable.kind === 'scope-unavailable' ? unavailable.view.undo : undefined).toBe(
      summary
    )
    const missing = planListResult(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'run-missing', {
        undo: summary
      }),
      { kind: 'none' }
    )
    expect(missing.kind === 'run-missing' ? missing.view.undo : undefined).toBe(summary)
  })

  it('写しの比較は undo を含める(L-423)', () => {
    expect(
      isSameAgentChangesView(
        makeAgentChangesRecordingView([]),
        makeAgentChangesRecordingView([], { undo: summary })
      )
    ).toBe(false)
    expect(
      isSameAgentChangesView(
        makeAgentChangesRecordingView([], { undo: makeAgentChangesUndoSummary() }),
        makeAgentChangesRecordingView([], { undo: makeAgentChangesUndoSummary() })
      )
    ).toBe(true)
    expect(
      isSameAgentChangesView(
        makeAgentChangesRecordingView([], { undo: makeAgentChangesUndoSummary({ undoId: 1 }) }),
        makeAgentChangesRecordingView([], { undo: makeAgentChangesUndoSummary({ undoId: 2 }) })
      )
    ).toBe(false)
  })
})

describe('記録の区別の要約の写し', () => {
  const attribution = makeAgentChangesLostSummary({ hadMarks: true })

  it('記録中の状態の attribution を写しへ写す(同じ記録で一覧を残すときも、要約は新しい状態のものにする)', () => {
    const previous = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
    const plan = planRecordingState(previous, makeAgentChangesRecordingState({ attribution }), {
      kind: 'all'
    })
    expect(plan.view.list).not.toBeNull()
    expect(plan.view.attribution).toBe(attribution)
  })

  it('一覧の結果(取れた一覧・範囲の一覧を出せない・実行が消えていた)の attribution を写しへ写す', () => {
    const listed = planListResult(makeAgentChangesListResult([], { attribution }), {
      kind: 'none'
    })
    expect(listed.kind === 'listed' ? listed.view.attribution : undefined).toBe(attribution)
    const unavailable = planListResult(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'end-not-recorded', {
        attribution
      }),
      { kind: 'none' }
    )
    expect(
      unavailable.kind === 'scope-unavailable' ? unavailable.view.attribution : undefined
    ).toBe(attribution)
    const missing = planListResult(
      makeAgentChangesScopeUnavailableListResult({ kind: 'run', runId: 1 }, 'run-missing', {
        attribution
      }),
      { kind: 'none' }
    )
    expect(missing.kind === 'run-missing' ? missing.view.attribution : undefined).toBe(attribution)
  })
})
