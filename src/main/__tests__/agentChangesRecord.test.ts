import { describe, it, expect } from 'vitest'
import type { AgentChangesRecord, AgentChangesRecordRun } from '../agentChangesRecord'
import {
  agentChangesRecordTempDirs,
  createAgentChangesRecord,
  dropRunsOverLimit,
  latestRecordedIndexPath,
  protectionTreeEntries,
  runAvailability,
  runStartFromSnapshotResult,
  runStartSnapshot,
  summarizeAgentChangesRuns
} from '../agentChangesRecord'
import type { BaselineSnapshot } from '../agentBaselineSnapshot'
import { resolveAgentChangesScope } from '../agentChangesScope'
import { makeAgentChangesRecord, makeBaselineSnapshot } from './helpers/agentBaselineFixtures'

const baseline = makeBaselineSnapshot({ tempDir: '/tmp/base', startedAt: 100 })
const snap = (n: number): BaselineSnapshot =>
  makeBaselineSnapshot({ tempDir: `/tmp/r${n}`, startedAt: n * 100 })
const recordOf = (runs: AgentChangesRecordRun[]): AgentChangesRecord =>
  makeAgentChangesRecord(runs, { baseline })
const baselineRun = (runId: number): AgentChangesRecordRun => ({
  runId,
  number: runId,
  start: { kind: 'baseline' }
})
const snapshotRun = (runId: number): AgentChangesRecordRun => ({
  runId,
  number: runId,
  start: { kind: 'snapshot', snapshot: snap(runId) }
})
const failedRun = (runId: number): AgentChangesRecordRun => ({
  runId,
  number: runId,
  start: { kind: 'failed', reason: 'too-many-untracked', startedAt: runId * 100 + 50 }
})
// 型の外の開始(将来の種類の追加・壊れた値)
const unknownRun = (runId: number): AgentChangesRecordRun => ({
  runId,
  number: runId,
  start: { kind: 'pending' } as unknown as AgentChangesRecordRun['start']
})

describe('summarizeAgentChangesRuns', () => {
  it('開始の時刻・終わりの時刻(次の実行の開始。最後は null)・番号を古い順に並べる', () => {
    expect(summarizeAgentChangesRuns(recordOf([baselineRun(1), snapshotRun(2)]))).toEqual([
      { runId: 1, number: 1, startedAt: 100, endedAt: 200, availability: { kind: 'available' } },
      { runId: 2, number: 2, startedAt: 200, endedAt: null, availability: { kind: 'available' } }
    ])
  })

  it('開始を記録できなかった実行は start-not-recorded(理由つき)、その 1 つ前の実行は end-not-recorded(L-002)', () => {
    expect(
      summarizeAgentChangesRuns(recordOf([baselineRun(1), failedRun(2), snapshotRun(3)]))
    ).toEqual([
      {
        runId: 1,
        number: 1,
        startedAt: 100,
        endedAt: 250,
        availability: { kind: 'end-not-recorded' }
      },
      {
        runId: 2,
        number: 2,
        startedAt: 250,
        endedAt: 300,
        availability: { kind: 'start-not-recorded', reason: 'too-many-untracked' }
      },
      { runId: 3, number: 3, startedAt: 300, endedAt: null, availability: { kind: 'available' } }
    ])
  })

  it('実行が無ければ空', () => {
    expect(summarizeAgentChangesRuns(recordOf([]))).toEqual([])
  })

  // 型の外の開始の種類を「選べる」へ黙って流さない
  it('未知の開始の種類は available にせず例外にする(次の実行の開始でも同じ)', () => {
    expect(() => summarizeAgentChangesRuns(recordOf([unknownRun(1)]))).toThrow(
      '未知の実行の開始です'
    )
    expect(() => summarizeAgentChangesRuns(recordOf([baselineRun(1), unknownRun(2)]))).toThrow(
      '未知の実行の開始です'
    )
  })
})

describe('runAvailability', () => {
  it('開始と終わり(次の実行の開始)が取れていれば available', () => {
    expect(runAvailability(baselineRun(1), snapshotRun(2))).toEqual({ kind: 'available' })
  })

  it('最後の実行(次が無い)は開始だけで決まる', () => {
    expect(runAvailability(snapshotRun(1), undefined)).toEqual({ kind: 'available' })
    expect(runAvailability(failedRun(1), undefined)).toEqual({
      kind: 'start-not-recorded',
      reason: 'too-many-untracked'
    })
  })

  it('開始が取れていて次の実行の開始が取れていなければ end-not-recorded', () => {
    expect(runAvailability(snapshotRun(1), failedRun(2))).toEqual({ kind: 'end-not-recorded' })
  })

  it('開始も終わりも取れていなければ、開始の理由を優先する', () => {
    expect(runAvailability(failedRun(1), failedRun(2))).toEqual({
      kind: 'start-not-recorded',
      reason: 'too-many-untracked'
    })
  })

  // 選択の項目(runs の availability)と範囲の解決が食い違わない(選べる実行で一覧が取れない・その逆が無い)
  it.each([
    ['取れた 3 件', [baselineRun(1), snapshotRun(2), snapshotRun(3)]],
    ['途中が取れない', [baselineRun(1), failedRun(2), snapshotRun(3)]],
    ['続けて取れない', [snapshotRun(1), failedRun(2), failedRun(3)]],
    ['最後が取れない', [snapshotRun(1), failedRun(2)]]
  ])('%s: 選べるかと範囲の解決の結果が一致する', (_label, runs) => {
    const record = recordOf(runs)
    record.runs.forEach((run, index) => {
      const availability = runAvailability(run, record.runs[index + 1])
      const resolved = resolveAgentChangesScope(record, { kind: 'run', runId: run.runId })
      if (availability.kind === 'available') {
        expect(resolved.kind).not.toBe('unavailable')
      } else {
        expect(resolved).toEqual({ kind: 'unavailable', reason: availability.kind })
      }
    })
  })
})

describe('latestRecordedIndexPath', () => {
  it('新しい方から見て最初の取れた記録のインデックス(取れなかった実行を飛ばす)', () => {
    expect(latestRecordedIndexPath(recordOf([baselineRun(1), snapshotRun(2), failedRun(3)]))).toBe(
      '/tmp/r2/index'
    )
  })

  it.each<[string, AgentChangesRecordRun[]]>([
    ['実行が無い', []],
    ['取れなかった実行だけ', [failedRun(1)]],
    ['開始が累積の始点の実行だけ', [baselineRun(1), failedRun(2)]]
  ])('%s なら累積の始点のインデックス', (_label, runs) => {
    expect(latestRecordedIndexPath(recordOf(runs))).toBe('/tmp/base/index')
  })
})

describe('agentChangesRecordTempDirs', () => {
  it('累積の始点と区切りの一時ディレクトリ(開始が累積の始点・取れなかった実行は足さない)', () => {
    expect(
      agentChangesRecordTempDirs(
        recordOf([baselineRun(1), snapshotRun(2), failedRun(3), snapshotRun(4)])
      )
    ).toEqual(['/tmp/base', '/tmp/r2', '/tmp/r4'])
  })

  it('未知の開始の種類は消さない側にも消す側にも流さず例外にする', () => {
    expect(() => agentChangesRecordTempDirs(recordOf([snapshotRun(1), unknownRun(2)]))).toThrow(
      '未知の実行の開始です'
    )
  })

  it('取り消しの控えの一時ディレクトリも返す(記録を捨てるときに消す)', () => {
    const record = makeAgentChangesRecord([], {
      baseline,
      undo: { undoId: 1, operation: 'file', dir: '/tmp/undo', items: [] }
    })
    expect(agentChangesRecordTempDirs(record)).toEqual([baseline.tempDir, '/tmp/undo'])
  })
})

describe('runStartSnapshot', () => {
  it('累積の始点・区切りの記録を返し、取れなかった実行は null', () => {
    const record = recordOf([baselineRun(1), snapshotRun(2), failedRun(3)])
    expect(runStartSnapshot(record, record.runs[0])).toBe(baseline)
    expect(runStartSnapshot(record, record.runs[1])?.tempDir).toBe('/tmp/r2')
    expect(runStartSnapshot(record, record.runs[2])).toBeNull()
  })

  it('未知の開始の種類は null(取れなかった)にも記録にも流さず例外にする', () => {
    const record = recordOf([unknownRun(1)])
    expect(() => runStartSnapshot(record, record.runs[0])).toThrow('未知の実行の開始です')
  })
})

describe('runStartFromSnapshotResult', () => {
  it('取れた区切りは snapshot の開始にする', () => {
    const snapshot = snap(3)
    expect(runStartFromSnapshotResult({ kind: 'recorded', snapshot }, 999)).toEqual({
      kind: 'snapshot',
      snapshot
    })
  })

  it('取れなかった区切りは理由と取り始めた時刻を持つ failed の開始にする', () => {
    expect(
      runStartFromSnapshotResult(
        { kind: 'unavailable', state: { kind: 'unavailable', reason: 'timeout' } },
        999
      )
    ).toEqual({ kind: 'failed', reason: 'timeout', startedAt: 999 })
  })
})

describe('dropRunsOverLimit', () => {
  it('上限以下なら何も外さず、消すディレクトリも無い', () => {
    const record = recordOf([baselineRun(1), snapshotRun(2)])
    expect(dropRunsOverLimit(record, 2)).toEqual([])
    expect(record.runs.map((run) => run.runId)).toEqual([1, 2])
  })

  it('上限を超えた古い実行を外し、外した区切りの一時ディレクトリだけを返す', () => {
    const record = recordOf([snapshotRun(1), snapshotRun(2), snapshotRun(3)])
    expect(dropRunsOverLimit(record, 2)).toEqual(['/tmp/r1'])
    expect(record.runs.map((run) => run.runId)).toEqual([2, 3])
  })

  it('開始が累積の始点・取れなかった実行を外しても、消すものは無い(始点は残す。L-004)', () => {
    const record = recordOf([baselineRun(1), failedRun(2), snapshotRun(3)])
    expect(dropRunsOverLimit(record, 1)).toEqual([])
    expect(record.runs.map((run) => run.runId)).toEqual([3])
  })

  it('記録の番号(nextNumber)と累積の始点は変えない', () => {
    const record = recordOf([snapshotRun(1), snapshotRun(2)])
    dropRunsOverLimit(record, 1)
    expect(record.nextNumber).toBe(3)
    expect(record.baseline).toBe(baseline)
  })

  it('外す実行の開始の種類が未知なら、消すかを決めずに例外にする(記録を捨てるときと同じ規則)', () => {
    const record = recordOf([unknownRun(1), snapshotRun(2)])
    expect(() => dropRunsOverLimit(record, 1)).toThrow('未知の実行の開始です')
  })
})

describe('createAgentChangesRecord', () => {
  it('実行なし・番号 1・保護はまだ作っていない状態で作る', () => {
    expect(
      createAgentChangesRecord(baseline, 3, 'refs/prompt-ide/agent-changes/1-00000000/3')
    ).toEqual({
      baseline,
      runs: [],
      nextNumber: 1,
      recordSerial: 3,
      protection: {
        refName: 'refs/prompt-ide/agent-changes/1-00000000/3',
        value: null,
        swept: false
      },
      undo: null
    })
  })
})

describe('protectionTreeEntries', () => {
  it('累積の始点(baseline)と、開始が区切りの実行(run-<runId>)だけを項目にする(baseline・failed の実行は作らない)', () => {
    const tree = 'c'.repeat(40)
    const record = makeAgentChangesRecord(
      [
        baselineRun(1),
        {
          // 名前に使うのが number ではなく runId であることを区別するため、値を変える
          runId: 5,
          number: 2,
          start: { kind: 'snapshot', snapshot: makeBaselineSnapshot({ tempDir: '/tmp/r2', tree }) }
        },
        failedRun(3)
      ],
      { baseline: makeBaselineSnapshot({ tree: 'd'.repeat(40) }) }
    )
    expect(protectionTreeEntries(record)).toEqual([
      { name: 'baseline', tree: 'd'.repeat(40) },
      { name: 'run-5', tree }
    ])
  })
})
