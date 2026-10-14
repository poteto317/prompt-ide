import { describe, expect, it, vi } from 'vitest'
import type { AgentChangeEntry } from '@shared/types'
import type { BaselineSnapshot, BaselineSnapshotResult } from '../agentBaselineSnapshot'
import {
  absorbAfterTask,
  absorbBeforeTask,
  loseAfterUnexpectedError,
  markAttributionLost,
  nextPeriodStart,
  syncAttributionStep
} from '../agentChangesAttributionSync'
import type { AttributionSyncContext } from '../agentChangesAttributionSync'
import type { TrackingAttribution } from '../agentChangesAttribution'
import type { AgentChangesRecord } from '../agentChangesRecord'
import type { AgentToolActivitySignal } from '../agentToolActivity'
import {
  makeAgentChangesRecord,
  makeBaselineSnapshot,
  makeTrackingAttribution
} from './helpers/agentBaselineFixtures'

// 同期・吸収の手順の単体テスト(区切りの取得・差分・削除の失敗の経路、区間の割り当て・印・段階の規則、予期しない例外の後始末)。
// 列での順序・待ち・close との競合など registry を通した振る舞いは agentBaselineRegistry.attribution.test.ts

const baseline = makeBaselineSnapshot({ tempDir: '/tmp/base', startedAt: 100 })
const checkpoint = makeBaselineSnapshot({ tempDir: '/tmp/cp-1', startedAt: 200 })
const nextSnapshot = makeBaselineSnapshot({ tempDir: '/tmp/cp-2', startedAt: 300 })

const entry = (path: string): AgentChangeEntry => ({
  path,
  status: 'M',
  isDirectory: false,
  notRecorded: false
})

/** 共有していない区切り /tmp/cp-1 を持つ、段階 idle の記録 */
const recordWithCheckpoint = (): AgentChangesRecord =>
  makeAgentChangesRecord([], {
    baseline,
    attribution: makeTrackingAttribution(baseline, {
      checkpoint: { snapshot: checkpoint, sharedWithBaseline: false }
    })
  })

interface ContextOptions {
  /** 追跡の合図。関数なら呼ぶたびに読み直す(手順 2 と手順 8 で違う値を返せる) */
  signal?: AgentToolActivitySignal | (() => AgentToolActivitySignal)
  snapshot?: BaselineSnapshotResult
  /** 区切りを取っている最中に起きること(列の外の打ち切りの印など)。区切りを返す直前に呼ぶ */
  duringSnapshot?: () => void
  collect?: () => Promise<AgentChangeEntry[]>
  stale?: () => boolean
  removeDir?: (dir: string) => Promise<void>
}

const contextOf = (
  record: AgentChangesRecord,
  {
    signal = { phase: 'agent', lost: null, unassignable: false },
    snapshot = { kind: 'recorded', snapshot: nextSnapshot },
    duringSnapshot = () => undefined,
    collect = async () => [entry('a.txt')],
    stale = () => false,
    removeDir = async () => undefined
  }: ContextOptions = {}
): AttributionSyncContext & {
  discarded: BaselineSnapshot[]
  removed: string[]
} => {
  const discarded: BaselineSnapshot[] = []
  const removed: string[] = []
  return {
    record,
    signal: typeof signal === 'function' ? signal : () => signal,
    takeSnapshot: vi.fn(async () => {
      duringSnapshot()
      return snapshot
    }),
    collectBetween: vi.fn(collect),
    isStale: stale,
    discardSnapshot: async (s) => {
      discarded.push(s)
    },
    removeDir: async (dir) => {
      await removeDir(dir)
      removed.push(dir)
    },
    now: () => 400,
    discarded,
    removed
  }
}

describe('markAttributionLost', () => {
  it('集合と印を残して lost にし、共有していない区切りを消す', async () => {
    const record = recordWithCheckpoint()
    if (record.attribution.kind !== 'tracking') throw new Error('tracking のはず')
    record.attribution.userPaths.add('u.txt')
    const removed: string[] = []
    await markAttributionLost(record, 'hooks-not-confirmed', {
      now: () => 500,
      removeDir: async (dir) => {
        removed.push(dir)
      }
    })
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'hooks-not-confirmed',
      lostAt: 500,
      userPaths: new Set(['u.txt']),
      staleCheckpointDirs: []
    })
    expect(removed).toEqual(['/tmp/cp-1'])
  })

  it('始点と共有している区切りは消さない', async () => {
    const record = makeAgentChangesRecord([], { baseline })
    const removeDir = vi.fn(async () => undefined)
    await markAttributionLost(record, 'checkpoint-failed', { now: () => 500, removeDir })
    expect(record.attribution.kind).toBe('lost')
    expect(removeDir).not.toHaveBeenCalled()
  })

  it('区切りを消せなければ削除待ちに入れる', async () => {
    const record = recordWithCheckpoint()
    await markAttributionLost(record, 'checkpoint-failed', {
      now: () => 500,
      removeDir: async () => {
        throw new Error('EBUSY')
      }
    })
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      staleCheckpointDirs: ['/tmp/cp-1']
    })
  })
})

describe.each([
  ['syncAttributionStep', syncAttributionStep],
  ['absorbBeforeTask', absorbBeforeTask]
] as const)('%s の区切り・差分の失敗', (_name, step) => {
  it('区切りを取れなければ lost にする(差分を求めない)', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, {
      snapshot: { kind: 'unavailable', state: { kind: 'unavailable', reason: 'timeout' } }
    })
    expect(await step(ctx)).toEqual({ kind: 'lost', phaseBefore: 'idle' })
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
    expect(ctx.collectBetween).not.toHaveBeenCalled()
  })

  it('区切りの取得が取り消されたら何もしない', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, { snapshot: { kind: 'canceled' } })
    expect(await step(ctx)).toEqual({ kind: 'skipped' })
    expect(record.attribution.kind).toBe('tracking')
  })

  it('区切りを取り終えた時点で古くなっていたら、取れた区切りを消して何もしない', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, { stale: () => true })
    expect(await step(ctx)).toEqual({ kind: 'skipped' })
    expect(ctx.discarded).toEqual([nextSnapshot])
    expect(ctx.collectBetween).not.toHaveBeenCalled()
  })

  it('差分に失敗したら、取れた区切りを消して lost にする(空の集合にしない)', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, {
      collect: async () => {
        throw new Error('git diff-tree に失敗')
      }
    })
    expect(await step(ctx)).toEqual({ kind: 'lost', phaseBefore: 'idle' })
    expect(ctx.discarded).toEqual([nextSnapshot])
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'checkpoint-failed',
      userPaths: new Set()
    })
  })

  it('差分を求めている間に古くなったら、取れた区切りを消して何もしない', async () => {
    const record = recordWithCheckpoint()
    let stale = false
    const ctx = contextOf(record, {
      stale: () => stale,
      collect: async () => {
        stale = true
        return [entry('a.txt')]
      }
    })
    expect(await step(ctx)).toEqual({ kind: 'skipped' })
    expect(ctx.discarded).toEqual([nextSnapshot])
    expect(record.attribution).toMatchObject({ kind: 'tracking', userPaths: new Set() })
  })

  it('差分を閉じた区間の段階(idle)に割り当て、前の区切りを消す', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record)
    expect(await step(ctx)).toMatchObject({ kind: 'synced', phaseBefore: 'idle' })
    expect(record.attribution).toMatchObject({
      kind: 'tracking',
      userPaths: new Set(['a.txt']),
      checkpoint: { snapshot: nextSnapshot, sharedWithBaseline: false }
    })
    expect(ctx.removed).toEqual(['/tmp/cp-1'])
  })

  it('前の区切りを消せなければ削除待ちに入れる', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, {
      removeDir: async () => {
        throw new Error('EBUSY')
      }
    })
    expect(await step(ctx)).toMatchObject({ kind: 'synced' })
    expect(record.attribution).toMatchObject({ staleCheckpointDirs: ['/tmp/cp-1'] })
  })
})

/** 区別している記録の区別(tracking でなければ投げる。テストの準備で印・段階を書き換えるため) */
function trackingOf(record: AgentChangesRecord): TrackingAttribution {
  if (record.attribution.kind !== 'tracking') throw new Error('tracking のはず')
  return record.attribution
}

const signalOf = (
  phase: AgentToolActivitySignal['phase'],
  overrides: Partial<AgentToolActivitySignal> = {}
): AgentToolActivitySignal => ({ phase, lost: null, unassignable: false, ...overrides })

describe('syncAttributionStep の区間の規則(手順 2〜9)', () => {
  it('手順 2: 区別をやめる合図があれば、区切りを取らずに合図の理由で lost にする', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, {
      signal: signalOf('agent', { lost: 'claude-version-unsupported' })
    })
    expect(await syncAttributionStep(ctx)).toEqual({ kind: 'lost', phaseBefore: 'idle' })
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'claude-version-unsupported'
    })
    expect(ctx.takeSnapshot).not.toHaveBeenCalled()
    expect(ctx.removed).toEqual(['/tmp/cp-1'])
  })

  it('手順 3: 段階が同じで印も無ければ区切りを取らない', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, { signal: signalOf('idle') })
    expect(await syncAttributionStep(ctx)).toEqual({ kind: 'skipped' })
    expect(ctx.takeSnapshot).not.toHaveBeenCalled()
  })

  it('手順 2 の合図の unassignable は、段階が同じでも区切りを取らせ、閉じた区間を割り当てず新しい区間にも印を残す', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, { signal: signalOf('idle', { unassignable: true }) })
    expect(await syncAttributionStep(ctx)).toEqual({
      kind: 'synced',
      phaseBefore: 'idle',
      requeue: false
    })
    expect(trackingOf(record)).toMatchObject({
      phase: 'idle',
      periodUnassignable: true,
      userPaths: new Set(),
      hadUnassignedSince: true
    })
  })

  it('agent の区間の差分はエージェントの集合に入れ、新しい段階は手順 8 の合図で決める(paused の区間を始めたら hadUnassignedSince を立てる)', async () => {
    const record = recordWithCheckpoint()
    trackingOf(record).phase = 'agent'
    const signals = [signalOf('idle'), signalOf('paused')]
    const ctx = contextOf(record, { signal: () => signals.shift() ?? signalOf('paused') })
    expect(await syncAttributionStep(ctx)).toMatchObject({ kind: 'synced', phaseBefore: 'agent' })
    expect(trackingOf(record)).toMatchObject({
      phase: 'paused',
      agentPaths: new Set(['a.txt']),
      userPaths: new Set(),
      hadUnassignedSince: true
    })
  })

  it('paused の区間の差分はどちらにも入れない', async () => {
    const record = recordWithCheckpoint()
    trackingOf(record).phase = 'paused'
    const ctx = contextOf(record, { signal: signalOf('idle') })
    expect(await syncAttributionStep(ctx)).toMatchObject({ kind: 'synced', phaseBefore: 'paused' })
    expect(trackingOf(record)).toMatchObject({
      phase: 'idle',
      userPaths: new Set(),
      agentPaths: new Set()
    })
  })

  it('手順 6: 区切りを取っている最中に立った打ち切りの印で、閉じた区間を割り当てず、手順 8 が idle なら並べ直す', async () => {
    const record = recordWithCheckpoint()
    const attribution = trackingOf(record)
    // 手順 2 は agent(ツールが始まった)、手順 8 は idle(区切りの最中に打ち切られたツールが終わった)
    const signals = [signalOf('agent'), signalOf('idle')]
    const ctx = contextOf(record, {
      signal: () => signals.shift() ?? signalOf('idle'),
      duringSnapshot: () => {
        // 受け口の打ち切り(registry の markToolStartTimedOut)と同じ書き換え
        attribution.periodUnassignable = true
        attribution.timedOutPending = true
      }
    })
    expect(await syncAttributionStep(ctx)).toEqual({
      kind: 'synced',
      phaseBefore: 'idle',
      requeue: true
    })
    expect(attribution).toMatchObject({
      phase: 'idle',
      periodUnassignable: true,
      timedOutPending: false,
      userPaths: new Set(),
      hadUnassignedSince: true
    })
  })

  it('同期の前の打ち切り(timedOutPending)は手順 4 で下ろし、手順 8 が agent なら並べ直さず印も立てない', async () => {
    const record = recordWithCheckpoint()
    const attribution = trackingOf(record)
    attribution.periodUnassignable = true
    attribution.timedOutPending = true
    const ctx = contextOf(record, { signal: signalOf('agent') })
    expect(await syncAttributionStep(ctx)).toEqual({
      kind: 'synced',
      phaseBefore: 'idle',
      requeue: false
    })
    expect(attribution).toMatchObject({
      phase: 'agent',
      periodUnassignable: false,
      timedOutPending: false,
      userPaths: new Set()
    })
  })

  it('区別を始めていない記録(trackingSince が null)は、割り当てる区間を始めた時点の時刻から区別する', async () => {
    const record = recordWithCheckpoint()
    const attribution = trackingOf(record)
    attribution.phase = 'paused'
    attribution.trackingSince = null
    const ctx = contextOf(record, { signal: signalOf('idle') })
    await syncAttributionStep(ctx)
    expect(attribution).toMatchObject({ trackingSince: 400, hadUnassignedSince: false })
  })
})

describe('absorbBeforeTask の区間の規則', () => {
  it('印のある区間の差分は割り当てず、印・timedOutPending・段階を変えない', async () => {
    const record = recordWithCheckpoint()
    const attribution = trackingOf(record)
    attribution.periodUnassignable = true
    attribution.timedOutPending = true
    const ctx = contextOf(record, { signal: signalOf('agent') })
    expect(await absorbBeforeTask(ctx)).toEqual({
      kind: 'synced',
      phaseBefore: 'idle',
      requeue: false
    })
    expect(attribution).toMatchObject({
      phase: 'idle',
      periodUnassignable: true,
      timedOutPending: true,
      userPaths: new Set(),
      hadUnassignedSince: true
    })
  })

  it('合図の unassignable は差分の後に今の区間の印として足す(閉じた区間の割り当ては差分の前の印で決める)', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, { signal: signalOf('agent', { unassignable: true }) })
    await absorbBeforeTask(ctx)
    expect(trackingOf(record)).toMatchObject({
      phase: 'idle',
      periodUnassignable: true,
      userPaths: new Set(['a.txt'])
    })
  })
})

describe('absorbAfterTask', () => {
  it('区切りを取れなければ lost にする', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, {
      snapshot: { kind: 'unavailable', state: { kind: 'unavailable', reason: 'timeout' } }
    })
    expect(await absorbAfterTask(ctx)).toEqual({ kind: 'lost', phaseBefore: 'idle' })
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'checkpoint-failed' })
  })

  it('区切りを置き換えて前の区切りを消し、差分はどちらの集合にも入れない', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record)
    expect(await absorbAfterTask(ctx)).toEqual({
      kind: 'synced',
      phaseBefore: 'idle',
      requeue: false
    })
    expect(ctx.collectBetween).not.toHaveBeenCalled()
    expect(record.attribution).toMatchObject({
      userPaths: new Set(),
      agentPaths: new Set(),
      checkpoint: { snapshot: nextSnapshot, sharedWithBaseline: false }
    })
    expect(ctx.removed).toEqual(['/tmp/cp-1'])
  })
})

describe('loseAfterUnexpectedError(予期しない例外の後始末)', () => {
  it('今の記録で区別していれば、段階を控えて lost にし、共有していない区切りを消す', async () => {
    const record = recordWithCheckpoint()
    if (record.attribution.kind !== 'tracking') throw new Error('tracking のはず')
    record.attribution.phase = 'agent'
    const ctx = contextOf(record)
    expect(await loseAfterUnexpectedError(ctx)).toEqual({ kind: 'lost', phaseBefore: 'agent' })
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      reason: 'checkpoint-failed',
      lostAt: 400
    })
    expect(ctx.removed).toEqual(['/tmp/cp-1'])
  })

  it('古くなっていれば何もせず skipped を返す', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, { stale: () => true })
    expect(await loseAfterUnexpectedError(ctx)).toEqual({ kind: 'skipped' })
    expect(record.attribution.kind).toBe('tracking')
    expect(ctx.removed).toEqual([])
  })

  it('既に区別をやめていれば何もせず skipped を返す', async () => {
    const record = recordWithCheckpoint()
    await markAttributionLost(record, 'hooks-not-confirmed', {
      now: () => 300,
      removeDir: async () => undefined
    })
    const ctx = contextOf(record)
    expect(await loseAfterUnexpectedError(ctx)).toEqual({ kind: 'skipped' })
    expect(record.attribution).toMatchObject({ kind: 'lost', reason: 'hooks-not-confirmed' })
  })

  it('区切りを消せなくても投げずに lost を返し、削除待ちに入れる', async () => {
    const record = recordWithCheckpoint()
    const ctx = contextOf(record, {
      removeDir: async () => {
        throw new Error('EBUSY')
      }
    })
    expect(await loseAfterUnexpectedError(ctx)).toEqual({ kind: 'lost', phaseBefore: 'idle' })
    expect(record.attribution).toMatchObject({
      kind: 'lost',
      staleCheckpointDirs: ['/tmp/cp-1']
    })
  })
})

describe('nextPeriodStart(手順 9 の規則)', () => {
  const sig = (
    phase: AgentToolActivitySignal['phase'],
    unassignable = false
  ): AgentToolActivitySignal => ({ phase, lost: null, unassignable })

  it('打ち切りも合図の印も無ければ、手順 8 の段階で印なしの区間を始める', () => {
    expect(
      nextPeriodStart({ timedOut: false, signalAtStart: sig('agent'), signalNow: sig('idle') })
    ).toEqual({ phase: 'idle', periodUnassignable: false, requeue: false })
  })

  it.each(['idle', 'paused'] as const)(
    '打ち切りがあり手順 8 の段階が %s なら並べ直し、印を立てる',
    (phase) => {
      expect(
        nextPeriodStart({ timedOut: true, signalAtStart: sig('agent'), signalNow: sig(phase) })
      ).toEqual({ phase, periodUnassignable: true, requeue: true })
    }
  )

  it('打ち切りがあっても手順 8 の段階が agent なら並べ直さず、印も立てない', () => {
    expect(
      nextPeriodStart({ timedOut: true, signalAtStart: sig('idle'), signalNow: sig('agent') })
    ).toEqual({ phase: 'agent', periodUnassignable: false, requeue: false })
  })

  it('手順 2・手順 8 のどちらかの合図の unassignable で印を立てる(並べ直さない)', () => {
    expect(
      nextPeriodStart({
        timedOut: false,
        signalAtStart: sig('agent', true),
        signalNow: sig('idle')
      })
    ).toEqual({ phase: 'idle', periodUnassignable: true, requeue: false })
    expect(
      nextPeriodStart({
        timedOut: false,
        signalAtStart: sig('agent'),
        signalNow: sig('idle', true)
      })
    ).toEqual({ phase: 'idle', periodUnassignable: true, requeue: false })
  })
})
