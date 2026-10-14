import { describe, expect, it } from 'vitest'
import type { AgentChangeEntry } from '@shared/types'
import {
  attributionLogLine,
  attributionTempDirs,
  authorsOf,
  initialAttribution,
  matches,
  needsCurrentPeriod,
  summarizeAttribution
} from '../agentChangesAttribution'
import type {
  AgentChangesAttribution,
  LostAttribution,
  TrackingAttribution
} from '../agentChangesAttribution'
import type { AgentToolActivitySignal, AgentToolPhase } from '../agentToolActivity'
import { makeBaselineSnapshot, makeTrackingAttribution } from './helpers/agentBaselineFixtures'

const baseline = makeBaselineSnapshot({ tempDir: '/tmp/base', startedAt: 100 })
const signal = (
  phase: AgentToolPhase,
  extra: Partial<AgentToolActivitySignal> = {}
): AgentToolActivitySignal => ({ phase, lost: null, unassignable: false, ...extra })
const start = (
  before: AgentToolActivitySignal,
  after: AgentToolActivitySignal,
  seqAfter = 3
): ReturnType<typeof initialAttribution> =>
  initialAttribution({ baseline, seqBefore: 3, seqAfter, signalBefore: before, signalAfter: after })

// 区別を始めたばかりの記録の区別(区別は始点の時刻 100 から)。形は共通の補助から作る
const tracking = (overrides: Partial<TrackingAttribution> = {}): TrackingAttribution =>
  makeTrackingAttribution(baseline, overrides)
const lost = (overrides: Partial<LostAttribution> = {}): LostAttribution => ({
  kind: 'lost',
  reason: 'checkpoint-failed',
  lostAt: 200,
  userPaths: new Set(),
  agentPaths: new Set(),
  trackingSince: 100,
  hadUnassignedSince: false,
  staleCheckpointDirs: [],
  ...overrides
})
const entry = (path: string, notRecorded = false): AgentChangeEntry => ({
  path,
  status: 'M',
  isDirectory: path.endsWith('/'),
  notRecorded
})

describe('initialAttribution(記録の始め方)', () => {
  it('idle で始まり idle で取り終え、通し番号が変わらなければ、始点を区切りにした tracking で、区別は始点の時刻から(同期しない)', () => {
    expect(start(signal('idle'), signal('idle'))).toEqual({
      attribution: tracking(),
      syncNow: false
    })
  })

  it('取り終えた時点が paused なら trackingSince は null(同期しない)', () => {
    expect(start(signal('idle'), signal('paused'))).toEqual({
      attribution: tracking({ phase: 'paused', trackingSince: null }),
      syncNow: false
    })
  })

  it('始点を取っている間に通し番号が変わったら、最初の区間に印を立てて同期を 1 回並べる(L-103)', () => {
    expect(start(signal('idle'), signal('idle'), 4)).toEqual({
      attribution: tracking({ periodUnassignable: true, trackingSince: null }),
      syncNow: true
    })
  })

  it.each<[string, AgentToolPhase, AgentToolPhase]>([
    ['取り始めが agent(pending を含む)', 'agent', 'idle'],
    ['取り終えが agent(pending を含む)', 'idle', 'agent']
  ])('%s なら印を立てて同期を 1 回並べる', (_label, before, after) => {
    expect(start(signal(before), signal(after))).toEqual({
      attribution: tracking({ phase: after, periodUnassignable: true, trackingSince: null }),
      syncNow: true
    })
  })

  it('取り始めにだけ合図の unassignable が立っていた(取っている間に保留が解けた)なら、印を立てて同期を並べる', () => {
    expect(start(signal('idle', { unassignable: true }), signal('idle'))).toEqual({
      attribution: tracking({ periodUnassignable: true, trackingSince: null }),
      syncNow: true
    })
  })

  it('取り終えた時点で合図の unassignable が立っていれば、印を立て trackingSince は null で、同期は並べない(合図が下りたときの同期に任せる)', () => {
    expect(
      start(signal('idle', { unassignable: true }), signal('idle', { unassignable: true }))
    ).toEqual({
      attribution: tracking({ periodUnassignable: true, trackingSince: null }),
      syncNow: false
    })
  })

  it('通し番号・段階の条件と合図の条件が両方成り立てば、印を立てて同期を並べる', () => {
    expect(start(signal('agent'), signal('agent', { unassignable: true }))).toEqual({
      attribution: tracking({ phase: 'agent', periodUnassignable: true, trackingSince: null }),
      syncNow: true
    })
  })

  it('区別をやめる合図があれば lost で始める(lostAt は始点の時刻。unassignable が同時に立っていても lost)', () => {
    expect(
      start(signal('agent'), signal('agent', { lost: 'hooks-not-confirmed', unassignable: true }))
    ).toEqual({
      attribution: lost({ reason: 'hooks-not-confirmed', lostAt: 100, trackingSince: null }),
      syncNow: false
    })
  })
})

describe('matches(パスの照合)', () => {
  it.each<[string, string, boolean]>([
    ['a.txt', 'a.txt', true],
    ['dir/', 'dir/a.txt', true],
    ['dir/a.txt', 'dir/', true],
    ['dir/', 'dir/', true],
    ['a', 'ab/', false],
    ['ab/', 'a', false],
    ['dir', 'dir/a.txt', false],
    ['dir/', 'dirx/a.txt', false],
    ['a.txt', 'b.txt', false]
  ])('%s と %s は %s', (entryPath, path, expected) => {
    expect(matches(entryPath, path)).toBe(expected)
  })
})

describe('authorsOf(行の author)', () => {
  const rows = [
    entry('u.txt'),
    entry('a.txt'),
    entry('m.txt'),
    entry('big.bin', true),
    entry('new/')
  ]

  it('利用者の集合だけに一致 → user、両方 → mixed、それ以外 → agent、notRecorded → null。フォルダの行は配下を含めて照合する', () => {
    const attribution = tracking({
      userPaths: new Set(['u.txt', 'm.txt', 'big.bin', 'new/x.txt']),
      agentPaths: new Set(['a.txt', 'm.txt', 'new/y.txt'])
    })
    expect(authorsOf(rows, attribution, [])).toEqual(['user', 'agent', 'mixed', null, 'mixed'])
  })

  it('今の区間は段階で割り当てる(idle → 利用者、agent → エージェント、paused → どちらでもない)', () => {
    const paths = ['u.txt']
    expect(authorsOf([entry('u.txt')], tracking({ phase: 'idle' }), paths)).toEqual(['user'])
    expect(
      authorsOf(
        [entry('u.txt')],
        tracking({ phase: 'agent', userPaths: new Set(['u.txt']) }),
        paths
      )
    ).toEqual(['mixed'])
    expect(authorsOf([entry('u.txt')], tracking({ phase: 'paused' }), paths)).toEqual(['agent'])
  })

  it('今の区間に印があれば割り当てない(呼び出し側も比べない)', () => {
    const attribution = tracking({ periodUnassignable: true })
    expect(needsCurrentPeriod(attribution)).toBe(false)
    expect(authorsOf([entry('u.txt')], attribution, ['u.txt'])).toEqual(['agent'])
  })

  it('区別していない記録(tracking で trackingSince が null、lost で集合が空)は、すべて null', () => {
    expect(authorsOf(rows, tracking({ trackingSince: null }), ['u.txt'])).toEqual(
      rows.map(() => null)
    )
    expect(authorsOf(rows, lost(), null)).toEqual(rows.map(() => null))
  })

  it('lost で集合があれば、今の区間を除いて集合だけで決める', () => {
    const attribution = lost({ userPaths: new Set(['u.txt']) })
    expect(needsCurrentPeriod(attribution)).toBe(false)
    expect(authorsOf([entry('u.txt'), entry('a.txt')], attribution, ['a.txt'])).toEqual([
      'user',
      'agent'
    ])
  })

  it('今の区間を比べなかった・失敗した(null)ときは集合だけで決める', () => {
    expect(needsCurrentPeriod(tracking())).toBe(true)
    expect(authorsOf([entry('u.txt')], tracking(), null)).toEqual(['agent'])
  })
})

describe('summarizeAttribution(要約)', () => {
  it('tracking は since・hadUnassignedSince', () => {
    expect(summarizeAttribution(tracking({ hadUnassignedSince: true }))).toEqual({
      kind: 'tracking',
      since: 100,
      hadUnassignedSince: true
    })
  })

  it('lost は理由・時刻・集合が空でないか(hadMarks)', () => {
    expect(summarizeAttribution(lost())).toEqual({
      kind: 'lost',
      reason: 'checkpoint-failed',
      lostAt: 200,
      hadMarks: false,
      since: 100,
      hadUnassignedSince: false
    })
    expect(summarizeAttribution(lost({ agentPaths: new Set(['a.txt']) }))).toMatchObject({
      hadMarks: true
    })
  })
})

describe('attributionTempDirs(記録を捨てるときに消す判定の区切り)', () => {
  it('始点と共有の区切りは返さず、共有でない区切りと削除待ちを返す', () => {
    expect(attributionTempDirs(tracking({ staleCheckpointDirs: ['/tmp/old'] }))).toEqual([
      '/tmp/old'
    ])
    expect(
      attributionTempDirs(
        tracking({
          checkpoint: {
            snapshot: makeBaselineSnapshot({ tempDir: '/tmp/cp' }),
            sharedWithBaseline: false
          },
          staleCheckpointDirs: ['/tmp/old']
        })
      )
    ).toEqual(['/tmp/cp', '/tmp/old'])
    expect(attributionTempDirs(lost({ staleCheckpointDirs: ['/tmp/old'] }))).toEqual(['/tmp/old'])
  })
})

describe('attributionLogLine(開発版のログ)', () => {
  it('段階・集合の件数・印・理由を 1 行にする(パスは出さない)', () => {
    const attribution: AgentChangesAttribution = tracking({
      phase: 'agent',
      userPaths: new Set(['secret/a.txt']),
      periodUnassignable: true
    })
    const line = attributionLogLine(1, '同期', 'idle', attribution)
    expect(line).toBe(
      '[agent-attribution] owner=1 event=同期 phase=idle→agent user=1 agent=0 unassignable=あり reason=-'
    )
    expect(line).not.toContain('secret')
    expect(attributionLogLine(2, '開始', null, lost({ reason: 'receiver-unavailable' }))).toBe(
      '[agent-attribution] owner=2 event=開始 phase=-→- user=0 agent=0 unassignable=なし reason=receiver-unavailable'
    )
  })
})
