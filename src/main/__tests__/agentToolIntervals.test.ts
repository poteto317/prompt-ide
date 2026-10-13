import { describe, expect, it } from 'vitest'
import {
  AGENT_DROPPED_TOOL_IDS_MAX,
  AGENT_TOOL_OPEN_MAX,
  applyToolIntervalEvent,
  createToolIntervals,
  earliestUnexpiredOpenedAt,
  markExpiredIntervals,
  openCountOf,
  openIntervalsOf
} from '../agentToolIntervals'
import {
  promptSubmit,
  sessionEnd,
  subagentStop,
  toolEnd,
  toolStart,
  turnEnd
} from './helpers/agentHookEventFixtures'

describe('agentToolIntervals(定数)', () => {
  it('設計書の値', () => {
    expect(AGENT_TOOL_OPEN_MAX).toBe(256)
    expect(AGENT_DROPPED_TOOL_IDS_MAX).toBe(1_024)
  })
})

describe('applyToolIntervalEvent', () => {
  it('confirm-only は何も変えない', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, promptSubmit(), 1)
    expect(openCountOf(intervals)).toBe(1)
  })

  it('tool-start は ID のある区間を now で開き、同じ ID は開き直さない', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a', 'agent-1'), 10)
    applyToolIntervalEvent(intervals, toolStart('a'), 20)
    expect([...intervals.openTools]).toEqual([
      ['a', { agentId: 'agent-1', openedAt: 10, expired: false }]
    ])
  })

  it('ID を読めない tool-start は ID なしの区間を開く', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart(null), 5)
    expect(intervals.anonymousOpen).toEqual([{ openedAt: 5, expired: false }])
  })

  it(`ID のある区間が ${AGENT_TOOL_OPEN_MAX} 件を超えたら一番古い ID を外して控える`, () => {
    const intervals = createToolIntervals()
    for (let i = 0; i <= AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(`id-${i}`), i)
    expect(intervals.openTools.size).toBe(AGENT_TOOL_OPEN_MAX)
    expect(intervals.openTools.has('id-0')).toBe(false)
    expect(intervals.droppedToolIds.has('id-0')).toBe(true)
  })

  it(`ID なしの区間が ${AGENT_TOOL_OPEN_MAX} 件を超えたら一番古い区間を捨てる`, () => {
    const intervals = createToolIntervals()
    for (let i = 0; i <= AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(null), i)
    expect(intervals.anonymousOpen).toHaveLength(AGENT_TOOL_OPEN_MAX)
    expect(intervals.anonymousOpen[0].openedAt).toBe(1)
  })

  it('subagent-stop は同じ agent_id の区間だけを閉じ、控えない', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a', 'x'), 0)
    applyToolIntervalEvent(intervals, toolStart('b', 'y'), 0)
    applyToolIntervalEvent(intervals, subagentStop('x'), 1)
    expect([...intervals.openTools.keys()]).toEqual(['b'])
    expect(intervals.droppedToolIds.size).toBe(0)
  })

  it('turn-end は agent_id の無い ID の区間だけを閉じて控え、agent_id のある区間と ID なしの区間は残す', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('main'), 0)
    applyToolIntervalEvent(intervals, toolStart('sub', 'x'), 0)
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    applyToolIntervalEvent(intervals, turnEnd(), 1)
    expect([...intervals.openTools.keys()]).toEqual(['sub'])
    expect(intervals.anonymousOpen).toHaveLength(1)
    expect([...intervals.droppedToolIds]).toEqual(['main'])
  })

  it('session-end はすべての区間を閉じ、ID のある区間を控える', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a', 'x'), 0)
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    applyToolIntervalEvent(intervals, sessionEnd(), 1)
    expect(openCountOf(intervals)).toBe(0)
    expect([...intervals.droppedToolIds]).toEqual(['a'])
  })

  it(`外した ID の控えは ${AGENT_DROPPED_TOOL_IDS_MAX} 件まで。足し直した ID は新しい側へ移る`, () => {
    const intervals = createToolIntervals()
    for (let i = 0; i < AGENT_DROPPED_TOOL_IDS_MAX; i++) intervals.droppedToolIds.add(`d-${i}`)
    // d-0 を足し直してから 1 件あふれさせると、d-0 ではなく d-1 が捨てられる
    applyToolIntervalEvent(intervals, toolStart('d-0'), 0)
    applyToolIntervalEvent(intervals, sessionEnd(), 0)
    applyToolIntervalEvent(intervals, toolStart('new'), 0)
    applyToolIntervalEvent(intervals, sessionEnd(), 0)
    expect(intervals.droppedToolIds.size).toBe(AGENT_DROPPED_TOOL_IDS_MAX)
    expect(intervals.droppedToolIds.has('d-0')).toBe(true)
    expect(intervals.droppedToolIds.has('d-1')).toBe(false)
    expect(intervals.droppedToolIds.has('new')).toBe(true)
  })
})

describe('applyToolIntervalEvent(tool-end の 4 つの規則)', () => {
  /** ID のある区間 a・ID なしの区間 2 つ(openedAt 0 と 1)・外した ID gone */
  const opened = (): ReturnType<typeof createToolIntervals> => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    applyToolIntervalEvent(intervals, toolStart(null), 1)
    intervals.droppedToolIds.add('gone')
    return intervals
  }

  it('(1) 開いた ID の区間を閉じ、ID なしの区間は残す', () => {
    const intervals = opened()
    applyToolIntervalEvent(intervals, toolEnd('a'), 2)
    expect(intervals.openTools.size).toBe(0)
    expect(intervals.anonymousOpen).toHaveLength(2)
  })

  it('(2) 外した ID は控えから消すだけで、何も閉じない', () => {
    const intervals = opened()
    applyToolIntervalEvent(intervals, toolEnd('gone'), 2)
    expect(intervals.droppedToolIds.size).toBe(0)
    expect(openCountOf(intervals)).toBe(3)
  })

  it('(3) どこにも無い読めた ID は、ID なしの一番古い区間を閉じる', () => {
    const intervals = opened()
    applyToolIntervalEvent(intervals, toolEnd('unknown'), 2)
    expect(intervals.anonymousOpen).toEqual([{ openedAt: 1, expired: false }])
    expect(intervals.openTools.has('a')).toBe(true)
  })

  it('(4) 読めない ID は何も閉じない', () => {
    const intervals = opened()
    applyToolIntervalEvent(intervals, toolEnd(null), 2)
    expect(openCountOf(intervals)).toBe(3)
    expect(intervals.droppedToolIds.has('gone')).toBe(true)
  })
})

describe('期限切れ', () => {
  it('markExpiredIntervals は maxMs を過ぎた区間を外さずに期限切れにする', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('old'), 0)
    applyToolIntervalEvent(intervals, toolStart(null), 50)
    applyToolIntervalEvent(intervals, toolStart('new'), 60)
    markExpiredIntervals(intervals, 100, 50)
    expect(openIntervalsOf(intervals).map((interval) => interval.expired)).toEqual([
      true,
      false,
      true
    ])
    expect(openCountOf(intervals)).toBe(3)
  })

  it('earliestUnexpiredOpenedAt は期限切れでない区間の一番早い openedAt で、無ければ null', () => {
    const intervals = createToolIntervals()
    expect(earliestUnexpiredOpenedAt(intervals)).toBeNull()
    applyToolIntervalEvent(intervals, toolStart('a'), 30)
    applyToolIntervalEvent(intervals, toolStart(null), 10)
    expect(earliestUnexpiredOpenedAt(intervals)).toBe(10)
    markExpiredIntervals(intervals, 20, 10)
    expect(earliestUnexpiredOpenedAt(intervals)).toBe(30)
    markExpiredIntervals(intervals, 40, 10)
    expect(earliestUnexpiredOpenedAt(intervals)).toBeNull()
  })
})
