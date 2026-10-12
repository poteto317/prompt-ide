import { describe, it, expect } from 'vitest'
import type { AgentChangesRecord, AgentChangesRecordRun } from '../agentChangesRecord'
import { resolveAgentChangesScope } from '../agentChangesScope'
import { makeAgentChangesRecord, makeBaselineSnapshot } from './helpers/agentBaselineFixtures'

const baseline = makeBaselineSnapshot({ tempDir: '/tmp/base' })
const r2 = makeBaselineSnapshot({ tempDir: '/tmp/r2' })
const r4 = makeBaselineSnapshot({ tempDir: '/tmp/r4' })
// 実行 1(開始は累積の始点)・実行 2(区切り)・実行 3(取れなかった)・実行 4(区切り。最後)
const runs: AgentChangesRecordRun[] = [
  { runId: 1, number: 1, start: { kind: 'baseline' } },
  { runId: 2, number: 2, start: { kind: 'snapshot', snapshot: r2 } },
  { runId: 3, number: 3, start: { kind: 'failed', reason: 'timeout', startedAt: 3 } },
  { runId: 4, number: 4, start: { kind: 'snapshot', snapshot: r4 } }
]
const record: AgentChangesRecord = makeAgentChangesRecord(runs, { baseline })

describe('resolveAgentChangesScope(設計書「範囲の解決」の表)', () => {
  it('all は累積(始点 → 作業ツリー)', () => {
    expect(resolveAgentChangesScope(record, { kind: 'all' })).toEqual({
      kind: 'cumulative',
      snapshot: baseline
    })
  })

  it('一覧に無い runId は run-missing', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 99 })).toEqual({
      kind: 'unavailable',
      reason: 'run-missing'
    })
  })

  it('開始が failed の実行は start-not-recorded', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 3 })).toEqual({
      kind: 'unavailable',
      reason: 'start-not-recorded'
    })
  })

  it('次の実行の開始が failed の実行は end-not-recorded(今までに読み替えない。L-002)', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 2 })).toEqual({
      kind: 'unavailable',
      reason: 'end-not-recorded'
    })
  })

  it('最後の実行は開始の記録 → 作業ツリー', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 4 })).toEqual({
      kind: 'toWorktree',
      snapshot: r4
    })
  })

  it('途中の実行は開始の記録(baseline は累積の始点)と次の実行の開始の記録', () => {
    expect(resolveAgentChangesScope(record, { kind: 'run', runId: 1 })).toEqual({
      kind: 'between',
      start: baseline,
      end: r2
    })
  })

  it('開始が累積の始点の最後の実行は、累積の始点 → 作業ツリー', () => {
    const only: AgentChangesRecord = makeAgentChangesRecord([runs[0]], { baseline })
    expect(resolveAgentChangesScope(only, { kind: 'run', runId: 1 })).toEqual({
      kind: 'toWorktree',
      snapshot: baseline
    })
  })
})
