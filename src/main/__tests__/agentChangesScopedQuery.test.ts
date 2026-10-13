import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../agentChangesQuery', () => ({
  listAgentChanges: vi.fn(),
  listAgentChangesBetween: vi.fn()
}))
vi.mock('../agentChangeDiff', () => ({
  getAgentChangeDiff: vi.fn(),
  getAgentChangeDiffBetween: vi.fn()
}))

import type { AgentChangesList } from '@shared/types'
import { getAgentChangeDiff, getAgentChangeDiffBetween } from '../agentChangeDiff'
import { listAgentChanges, listAgentChangesBetween } from '../agentChangesQuery'
import type { AgentChangesRecord } from '../agentChangesRecord'
import {
  AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE,
  getAgentChangeDiffInScope,
  listAgentChangesInScope
} from '../agentChangesScopedQuery'
import { makeAgentChangesRecord, makeBaselineSnapshot } from './helpers/agentBaselineFixtures'

const baseline = makeBaselineSnapshot({ tempDir: '/tmp/base', startedAt: 100 })
const r2 = makeBaselineSnapshot({ tempDir: '/tmp/r2', startedAt: 200 })
const r3 = makeBaselineSnapshot({ tempDir: '/tmp/r3', startedAt: 300 })
// 実行 1(開始は始点)→ 実行 2 → 実行 3(最後)
const record: AgentChangesRecord = makeAgentChangesRecord(
  [
    { runId: 1, number: 1, start: { kind: 'baseline' } },
    { runId: 2, number: 2, start: { kind: 'snapshot', snapshot: r2 } },
    { runId: 3, number: 3, start: { kind: 'snapshot', snapshot: r3 } }
  ],
  { baseline }
)
const list: AgentChangesList = {
  entries: [{ path: 'a.txt', status: 'M', isDirectory: false, notRecorded: false }],
  totalCount: 1,
  truncated: false,
  headChanged: false
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(listAgentChanges).mockResolvedValue(list)
  vi.mocked(listAgentChangesBetween).mockResolvedValue(list)
  vi.mocked(getAgentChangeDiff).mockResolvedValue('cumulative-diff')
  vi.mocked(getAgentChangeDiffBetween).mockResolvedValue('between-diff')
})

describe('listAgentChangesInScope', () => {
  it('累積は始点と作業ツリーを比べ、始点の時刻・実行の一覧・範囲を添える', async () => {
    const result = await listAgentChangesInScope(record, { kind: 'all' })
    expect(listAgentChanges).toHaveBeenCalledWith(baseline)
    expect(listAgentChangesBetween).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      kind: 'recording',
      startedAt: 100,
      scope: { kind: 'all' },
      undo: null,
      totalCount: 1
    })
    expect(result.kind === 'recording' && result.runs.map((run) => run.runId)).toEqual([1, 2, 3])
  })

  it('最後の実行は開始の区切りと作業ツリーを比べる', async () => {
    await listAgentChangesInScope(record, { kind: 'run', runId: 3 })
    expect(listAgentChanges).toHaveBeenCalledWith(r3)
  })

  it('途中の実行は開始と次の実行の開始の区切りどうしを比べる(開始が始点の実行は始点から)', async () => {
    await listAgentChangesInScope(record, { kind: 'run', runId: 1 })
    expect(listAgentChangesBetween).toHaveBeenCalledWith(baseline, r2)
    expect(listAgentChanges).not.toHaveBeenCalled()
  })

  it('選べない範囲は一覧を作らず理由を返す', async () => {
    const result = await listAgentChangesInScope(record, { kind: 'run', runId: 99 })
    expect(result).toMatchObject({
      kind: 'scope-unavailable',
      reason: 'run-missing',
      scope: { kind: 'run', runId: 99 },
      startedAt: 100,
      undo: null
    })
    expect(listAgentChanges).not.toHaveBeenCalled()
    expect(listAgentChangesBetween).not.toHaveBeenCalled()
  })

  it('控えのある記録は recording・scope-unavailable の結果に要約を入れる(控えの dir は入れない)', async () => {
    const withUndo = makeAgentChangesRecord([...record.runs], {
      baseline,
      undo: { undoId: 3, operation: 'all', dir: '/tmp/u', items: [] }
    })
    const summary = { undoId: 3, operation: 'all', entries: [] }
    const recording = await listAgentChangesInScope(withUndo, { kind: 'all' })
    expect(recording).toMatchObject({ kind: 'recording', undo: summary })
    const unavailable = await listAgentChangesInScope(withUndo, { kind: 'run', runId: 99 })
    expect(unavailable).toMatchObject({ kind: 'scope-unavailable', undo: summary })
    expect(JSON.stringify([recording, unavailable])).not.toContain('/tmp/u')
  })
})

describe('getAgentChangeDiffInScope', () => {
  it('累積・最後の実行は作業ツリーとの diff', async () => {
    await expect(getAgentChangeDiffInScope(record, { kind: 'all' }, 'a.txt')).resolves.toBe(
      'cumulative-diff'
    )
    expect(getAgentChangeDiff).toHaveBeenLastCalledWith(baseline, 'a.txt')
    await getAgentChangeDiffInScope(record, { kind: 'run', runId: 3 }, 'a.txt')
    expect(getAgentChangeDiff).toHaveBeenLastCalledWith(r3, 'a.txt')
  })

  it('途中の実行は区切りどうしの diff', async () => {
    await expect(
      getAgentChangeDiffInScope(record, { kind: 'run', runId: 2 }, 'a.txt')
    ).resolves.toBe('between-diff')
    expect(getAgentChangeDiffBetween).toHaveBeenCalledWith(r2, r3, 'a.txt')
  })

  it('選べない範囲は例外で、diff を取らない', async () => {
    await expect(
      getAgentChangeDiffInScope(record, { kind: 'run', runId: 99 }, 'a.txt')
    ).rejects.toThrow(AGENT_CHANGES_SCOPE_DIFF_UNAVAILABLE_MESSAGE)
    expect(getAgentChangeDiff).not.toHaveBeenCalled()
    expect(getAgentChangeDiffBetween).not.toHaveBeenCalled()
  })
})
