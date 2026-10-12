import { describe, it, expect } from 'vitest'
import {
  AGENT_CHANGES_ALL_SCOPE,
  decodeAgentChangesScopeValue,
  encodeAgentChangesScopeValue,
  findAgentChangesRun,
  getListedAgentChanges
} from '../agentChangesScope'
import {
  makeAgentChangeEntry,
  makeAgentChangesRecordingView,
  makeAgentChangesRun,
  makeAgentChangesScopeUnavailableView
} from '../../__tests__/makeAgentChangesState'

describe('getListedAgentChanges', () => {
  it('記録中で範囲の一覧が取れていれば、その一覧を返す', () => {
    const view = makeAgentChangesRecordingView([makeAgentChangeEntry('a.txt')])
    expect(getListedAgentChanges(view)?.entries.map((entry) => entry.path)).toEqual(['a.txt'])
  })

  it('記録なし・取り直す前・範囲の一覧が取れない(scope-unavailable)なら null', () => {
    expect(getListedAgentChanges({ kind: 'none' })).toBeNull()
    expect(getListedAgentChanges(makeAgentChangesRecordingView(null))).toBeNull()
    expect(
      getListedAgentChanges(
        makeAgentChangesScopeUnavailableView({ kind: 'run', runId: 2 }, 'end-not-recorded')
      )
    ).toBeNull()
  })
})

describe('findAgentChangesRun', () => {
  it('runId の実行を返し、無ければ undefined', () => {
    const runs = [makeAgentChangesRun({ runId: 1 }), makeAgentChangesRun({ runId: 4, number: 2 })]
    expect(findAgentChangesRun(runs, 4)?.number).toBe(2)
    expect(findAgentChangesRun(runs, 9)).toBeUndefined()
  })
})

it('累積の範囲', () => {
  expect(AGENT_CHANGES_ALL_SCOPE).toEqual({ kind: 'all' })
})

describe('encodeAgentChangesScopeValue / decodeAgentChangesScopeValue', () => {
  it('累積は all、実行は run:<runId> にし、元に戻せる', () => {
    expect(encodeAgentChangesScopeValue({ kind: 'all' })).toBe('all')
    expect(encodeAgentChangesScopeValue({ kind: 'run', runId: 12 })).toBe('run:12')
    expect(decodeAgentChangesScopeValue('all')).toEqual({ kind: 'all' })
    expect(decodeAgentChangesScopeValue('run:12')).toEqual({ kind: 'run', runId: 12 })
  })

  it('形が違う値は null(選択を変えない)', () => {
    expect(decodeAgentChangesScopeValue('')).toBeNull()
    expect(decodeAgentChangesScopeValue('12')).toBeNull()
    expect(decodeAgentChangesScopeValue('run:abc')).toBeNull()
    expect(decodeAgentChangesScopeValue('run:1.5')).toBeNull()
  })

  it('エンコードの形(run: の後に 1 以上の 10 進の整数)でなければ null(Number が受け付ける形も通さない)', () => {
    for (const value of ['run:', 'run:0', 'run:-1', 'run: 3', 'run:1e1', 'run:0x10', 'run:01']) {
      expect(decodeAgentChangesScopeValue(value)).toBeNull()
    }
    expect(decodeAgentChangesScopeValue('run:9007199254740993')).toBeNull()
  })
})
