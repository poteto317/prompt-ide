import { describe, expect, it } from 'vitest'
import {
  AGENT_DROPPED_TOOL_IDS_MAX,
  AGENT_TOOL_OPEN_MAX,
  applyToolIntervalEvent,
  createToolIntervals,
  earliestUnexpiredOpenedAt,
  hasUnassignableInterval,
  markExpiredIntervals,
  openCountOf,
  openIntervalsOf
} from '../agentToolIntervals'
import {
  batchEnd,
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
      ['a', { agentId: 'agent-1', openedAt: 10, expired: false, ended: false }]
    ])
  })

  it('ID を読めない tool-start は ID なしの区間を開く', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart(null), 5)
    expect(intervals.anonymousOpen).toEqual([{ openedAt: 5, expired: false }])
  })

  it(`ID のある区間が ${AGENT_TOOL_OPEN_MAX} 件ある間の tool-start は区間を足さず(一番古い区間も外さない)、overflowed を立てて ID を控える`, () => {
    const intervals = createToolIntervals()
    for (let i = 0; i < AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(`id-${i}`), i)
    applyToolIntervalEvent(intervals, toolStart('over'), 999)
    expect(intervals.openTools.size).toBe(AGENT_TOOL_OPEN_MAX)
    expect(intervals.openTools.has('id-0')).toBe(true)
    expect(intervals.openTools.has('over')).toBe(false)
    expect(intervals.overflowed).toBe(true)
    expect(intervals.droppedToolIds.has('over')).toBe(true)
    expect(openCountOf(intervals)).toBe(AGENT_TOOL_OPEN_MAX + 1)
    expect(hasUnassignableInterval(intervals)).toBe(true)
  })

  it(`ID なしの区間も ${AGENT_TOOL_OPEN_MAX} 件ある間の tool-start は足さず(一番古い区間も捨てない)、overflowed を立てる`, () => {
    const intervals = createToolIntervals()
    for (let i = 0; i <= AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(null), i)
    expect(intervals.anonymousOpen).toHaveLength(AGENT_TOOL_OPEN_MAX)
    expect(intervals.anonymousOpen[0].openedAt).toBe(0)
    expect(intervals.overflowed).toBe(true)
  })

  it('subagent-stop は同じ agent_id の区間だけを閉じ、外した ID を控える', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a', 'x'), 0)
    applyToolIntervalEvent(intervals, toolStart('b', 'y'), 0)
    applyToolIntervalEvent(intervals, subagentStop('x'), 1)
    expect([...intervals.openTools.keys()]).toEqual(['b'])
    expect([...intervals.droppedToolIds]).toEqual(['a'])
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

  it('(1) 開いた ID の区間は、agent_id が無ければ外さずに ended にし(PostToolBatch を待つ)、ID なしの区間は残す', () => {
    const intervals = opened()
    applyToolIntervalEvent(intervals, toolEnd('a'), 2)
    expect(intervals.openTools.get('a')?.ended).toBe(true)
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

describe('applyToolIntervalEvent(PostToolBatch と ended)', () => {
  it('ID があって agent_id の無い区間は、自分の tool-end で外さずに ended にし、batch-end で外す(控えない)', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, toolEnd('a'), 1)
    expect(intervals.openTools.get('a')).toEqual({
      agentId: null,
      openedAt: 0,
      expired: false,
      ended: true
    })
    expect(openCountOf(intervals)).toBe(1)
    applyToolIntervalEvent(intervals, batchEnd(), 2)
    expect(openCountOf(intervals)).toBe(0)
    expect(intervals.droppedToolIds.size).toBe(0)
  })

  it('ended の区間の 2 回目の tool-end では何も変わらない(ID なしの区間を閉じない)', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    applyToolIntervalEvent(intervals, toolEnd('a'), 1)
    applyToolIntervalEvent(intervals, toolEnd('a'), 2)
    expect(intervals.openTools.get('a')?.ended).toBe(true)
    expect(intervals.anonymousOpen).toHaveLength(1)
  })

  it('batch-end は ended でない区間(同じバッチで並行に動くツール)・agent_id のある区間・ID なしの区間を残す', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, toolStart('b'), 0)
    applyToolIntervalEvent(intervals, toolStart('c', 'x'), 0)
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    applyToolIntervalEvent(intervals, toolEnd('a'), 1)
    applyToolIntervalEvent(intervals, batchEnd(), 2)
    expect([...intervals.openTools.keys()]).toEqual(['b', 'c'])
    expect(intervals.anonymousOpen).toHaveLength(1)
  })

  it('agent_id のある区間は今どおり自分の tool-end で外す', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a', 'x'), 0)
    applyToolIntervalEvent(intervals, toolEnd('a', 'x'), 1)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('ended の区間も期限切れになり、batch-end で外す', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    applyToolIntervalEvent(intervals, toolEnd('a'), 1)
    markExpiredIntervals(intervals, 100, 50)
    expect(intervals.openTools.get('a')?.expired).toBe(true)
    applyToolIntervalEvent(intervals, batchEnd(), 101)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('turn-end・session-end は ended の区間も外し、その ID を控えない(遅れた tool-end は来ない)', () => {
    const forTurn = createToolIntervals()
    applyToolIntervalEvent(forTurn, toolStart('a'), 0)
    applyToolIntervalEvent(forTurn, toolStart('b'), 0)
    applyToolIntervalEvent(forTurn, toolEnd('a'), 1)
    applyToolIntervalEvent(forTurn, turnEnd(), 2)
    expect(openCountOf(forTurn)).toBe(0)
    expect([...forTurn.droppedToolIds]).toEqual(['b'])

    const forSession = createToolIntervals()
    applyToolIntervalEvent(forSession, toolStart('a'), 0)
    applyToolIntervalEvent(forSession, toolStart('b'), 0)
    applyToolIntervalEvent(forSession, toolEnd('a'), 1)
    applyToolIntervalEvent(forSession, sessionEnd(), 2)
    expect(openCountOf(forSession)).toBe(0)
    expect([...forSession.droppedToolIds]).toEqual(['b'])
  })

  it('区間を外す 4 つの知らせは同じ規則で控える: ended でない ID だけを外した順に控え、ended の ID は控えない', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('main-ended'), 0)
    applyToolIntervalEvent(intervals, toolStart('main-running'), 0)
    applyToolIntervalEvent(intervals, toolStart('sub-1', 'agent-1'), 0)
    applyToolIntervalEvent(intervals, toolStart('sub-2', 'agent-2'), 0)
    applyToolIntervalEvent(intervals, toolEnd('main-ended'), 1)

    applyToolIntervalEvent(intervals, batchEnd(), 2)
    expect([...intervals.droppedToolIds]).toEqual([])
    applyToolIntervalEvent(intervals, subagentStop('agent-1'), 3)
    expect([...intervals.droppedToolIds]).toEqual(['sub-1'])
    applyToolIntervalEvent(intervals, turnEnd(), 4)
    expect([...intervals.droppedToolIds]).toEqual(['sub-1', 'main-running'])
    applyToolIntervalEvent(intervals, sessionEnd(), 5)
    expect([...intervals.droppedToolIds]).toEqual(['sub-1', 'main-running', 'sub-2'])
    expect(openCountOf(intervals)).toBe(0)
  })
})

describe('あふれと控え(頑健性の 4)', () => {
  it('あふれた ID の遅れた tool-end は、ID なしの区間を閉じない', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    // 上限は ID のある区間と ID なしの区間で別に数える(ID のある区間を 256 件にする)
    for (let i = 0; i < AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(`id-${i}`), i)
    applyToolIntervalEvent(intervals, toolStart('over'), 999)
    applyToolIntervalEvent(intervals, toolEnd('over'), 1_000)
    expect(intervals.anonymousOpen).toHaveLength(1)
  })

  it('overflowed は turn-end では残り(どのエージェントの区間かが分からない)、session-end で下ろす', () => {
    const intervals = createToolIntervals()
    for (let i = 0; i <= AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, toolStart(`id-${i}`), i)
    applyToolIntervalEvent(intervals, turnEnd(), 1_000)
    expect(intervals.overflowed).toBe(true)
    expect(openCountOf(intervals)).toBe(1)
    applyToolIntervalEvent(intervals, sessionEnd(), 1_001)
    expect(intervals.overflowed).toBe(false)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('subagent-stop で外した ID の遅れた tool-end は、ID なしの区間を閉じない', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart(null), 0)
    applyToolIntervalEvent(intervals, toolStart('a', 'x'), 0)
    applyToolIntervalEvent(intervals, subagentStop('x'), 1)
    applyToolIntervalEvent(intervals, toolEnd('a', 'x'), 2)
    expect(intervals.anonymousOpen).toHaveLength(1)
  })

  it('hasUnassignableInterval は期限切れの区間があるか overflowed のときだけ真', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, toolStart('a'), 0)
    expect(hasUnassignableInterval(intervals)).toBe(false)
    markExpiredIntervals(intervals, 100, 50)
    expect(hasUnassignableInterval(intervals)).toBe(true)
    const overflowed = createToolIntervals()
    overflowed.overflowed = true
    expect(hasUnassignableInterval(overflowed)).toBe(true)
  })
})
