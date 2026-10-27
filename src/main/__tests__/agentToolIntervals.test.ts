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
import type { ToolIntervals } from '../agentToolIntervals'
import type { AgentHookEvent } from '../agentHookEvents'
import {
  batchEnd,
  confirmOnly,
  idlessToolEnd,
  idlessToolStart,
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

describe('applyToolIntervalEvent(ID を持たない CLI の区間。段階 3b)', () => {
  /** 知らせを順に当てる(openedAt は start から 1 ずつ進める) */
  function run(intervals: ToolIntervals, events: AgentHookEvent[], start = 0): void {
    events.forEach((event, index) => applyToolIntervalEvent(intervals, event, start + index))
  }
  /** 開いた ID を持たない区間の [グループ, 持ち越し] の並び(開いた順) */
  const groupsOf = (intervals: ToolIntervals): Array<[string | null, boolean]> =>
    intervals.idlessOpen.map((interval) => [interval.group, interval.carried])

  it('createToolIntervals は空の idlessOpen・idlessEndedGroups から始める', () => {
    const intervals = createToolIntervals()
    expect(intervals.idlessOpen).toEqual([])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })

  it('tool-start(none)はグループ付きの持ち越しでない区間を now で開き、開いた区間の数と openIntervalsOf に入る(ID のある区間・ID なしの区間は変えない)', () => {
    const intervals = createToolIntervals()
    // 先に ID のある区間と ID なしの区間を 1 つずつ開いておく
    applyToolIntervalEvent(intervals, toolStart('a'), 1)
    applyToolIntervalEvent(intervals, toolStart(null), 2)
    applyToolIntervalEvent(intervals, idlessToolStart(), 10)
    applyToolIntervalEvent(intervals, idlessToolStart('sub-1'), 11)
    expect(intervals.idlessOpen).toEqual([
      { openedAt: 10, expired: false, group: null, carried: false },
      { openedAt: 11, expired: false, group: 'sub-1', carried: false }
    ])
    expect(openCountOf(intervals)).toBe(4)
    expect(openIntervalsOf(intervals)).toHaveLength(4)
    expect([...intervals.openTools]).toEqual([
      ['a', { agentId: null, openedAt: 1, expired: false, ended: false }]
    ])
    expect(intervals.anonymousOpen).toEqual([{ openedAt: 2, expired: false }])
  })

  it('並列のバッチ(記録 02): pre A・pre B・post B・post A で 0 に戻り、主が集合に入る', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    expect(openCountOf(intervals)).toBe(1)
    expect([...intervals.idlessEndedGroups]).toEqual([null])
    applyToolIntervalEvent(intervals, idlessToolEnd(), 3)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('次のバッチの tool-start は主を集合から外す(閉じる区間が無ければ何も閉じない)', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolEnd(), idlessToolStart()])
    expect(groupsOf(intervals)).toEqual([[null, false]])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })

  it('断った・同じバッチ: tool-end の後の tool-start は、そのグループの前のバッチの残りを閉じてから開く', () => {
    const intervals = createToolIntervals()
    // pre A・pre B(断る)・post A で 1 つ残る
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    expect(openCountOf(intervals)).toBe(1)
    // 次のバッチの pre C で残り(B)を閉じる
    applyToolIntervalEvent(intervals, idlessToolStart(), 3)
    expect(intervals.idlessOpen).toEqual([
      { openedAt: 3, expired: false, group: null, carried: false }
    ])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })

  it('断った・続けて呼ぶ(記録 60・36・50): 間に tool-end の無い tool-start では閉じず、残りは turn-end で閉じる', () => {
    const intervals = createToolIntervals()
    // pre A(断る)・pre B・post B
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    expect(openCountOf(intervals)).toBe(1)
    applyToolIntervalEvent(intervals, turnEnd(), 3)
    expect(openCountOf(intervals)).toBe(0)
    expect(intervals.idlessEndedGroups.has(null)).toBe(false)
  })

  it('中断の後の持ち越し(記録 61・62): pre B → prompt-submit → pre C → post C → pre D → post D で B が残り、turn-end で閉じる', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, idlessToolStart(), 0)
    applyToolIntervalEvent(intervals, promptSubmit(), 1)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    run(intervals, [idlessToolStart(), idlessToolEnd()], 2)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    expect(intervals.idlessEndedGroups.has(null)).toBe(true)
    run(intervals, [idlessToolStart(), idlessToolEnd()], 4)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    applyToolIntervalEvent(intervals, turnEnd(), 6)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('並列の途中の中断: pre A・pre B・post A → prompt-submit → pre C → post C → pre D でも、残りは turn-end まで開いたまま', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    applyToolIntervalEvent(intervals, promptSubmit(), 3)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    expect(intervals.idlessEndedGroups.size).toBe(0)
    run(intervals, [idlessToolStart(), idlessToolEnd(), idlessToolStart()], 4)
    expect(groupsOf(intervals)).toEqual([
      [null, true],
      [null, false]
    ])
    applyToolIntervalEvent(intervals, turnEnd(), 7)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('prompt-submit を受けないと、中断したツールの区間は post C の数の消費と pre D の区切りで閉じる(既知の制約)', () => {
    const intervals = createToolIntervals()
    // B(中断)・C
    run(intervals, [idlessToolStart(), idlessToolStart()])
    // post C は一番古い区間(B)を閉じる
    applyToolIntervalEvent(intervals, idlessToolEnd(), 2)
    expect(intervals.idlessOpen.map((interval) => interval.openedAt)).toEqual([1])
    // pre D は前のバッチの残り(C の分)を閉じる
    applyToolIntervalEvent(intervals, idlessToolStart(), 3)
    expect(intervals.idlessOpen.map((interval) => interval.openedAt)).toEqual([3])
  })

  it('tool-end は持ち越しの区間を閉じず、持ち越しでない一番古い区間を閉じる。持ち越しでない区間が無くても集合には入れる', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, idlessToolStart(), 0)
    applyToolIntervalEvent(intervals, promptSubmit(), 1)
    run(intervals, [idlessToolStart(), idlessToolStart()], 2)
    applyToolIntervalEvent(intervals, idlessToolEnd(), 4)
    expect(intervals.idlessOpen.map((interval) => [interval.openedAt, interval.carried])).toEqual([
      [0, true],
      [3, false]
    ])
    applyToolIntervalEvent(intervals, idlessToolEnd(), 5)
    expect(intervals.idlessOpen.map((interval) => [interval.openedAt, interval.carried])).toEqual([
      [0, true]
    ])
    // 次のプロンプトで主を集合から外してから(前の tool-end で入った主が残っていると、入れたかを区別できないため)、
    // 持ち越しの区間しか無い主の tool-end を当てる
    applyToolIntervalEvent(intervals, promptSubmit(), 6)
    expect(intervals.idlessEndedGroups.has(null)).toBe(false)
    applyToolIntervalEvent(intervals, idlessToolEnd(), 7)
    expect(intervals.idlessOpen.map((interval) => [interval.openedAt, interval.carried])).toEqual([
      [0, true]
    ])
    expect(intervals.idlessEndedGroups.has(null)).toBe(true)
  })

  it('prompt-submit は主のグループだけに持ち越しの印を付ける(サブエージェントのグループと集合のサブエージェントの ID は変えない)', () => {
    const intervals = createToolIntervals()
    run(intervals, [
      idlessToolStart(),
      idlessToolStart('sub-1'),
      idlessToolStart('sub-1'),
      idlessToolEnd('sub-1'),
      promptSubmit()
    ])
    expect(groupsOf(intervals)).toEqual([
      [null, true],
      ['sub-1', false]
    ])
    expect([...intervals.idlessEndedGroups]).toEqual(['sub-1'])
  })

  it('prompt-submit 以外の confirm-only は、印も集合も変えない', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolStart(), idlessToolEnd()])
    run(
      intervals,
      [
        confirmOnly('subagent-prompt'),
        confirmOnly('other-session-end'),
        confirmOnly('session-id-unreadable'),
        confirmOnly('stop-while-awaiting'),
        confirmOnly('copilot-body-unreadable'),
        confirmOnly('subagent-stop-unmatched'),
        confirmOnly('main-was-subagent'),
        confirmOnly('unknown-tool-end')
      ],
      3
    )
    expect(groupsOf(intervals)).toEqual([[null, false]])
    expect([...intervals.idlessEndedGroups]).toEqual([null])
  })

  it('サブエージェントのグループ(記録 70)は主の turn-end で閉じず、自分の subagent-stop で閉じて集合からも外れる', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart('sub-1'), idlessToolStart('sub-1'), idlessToolEnd('sub-1')])
    applyToolIntervalEvent(intervals, turnEnd(), 3)
    expect(groupsOf(intervals)).toEqual([['sub-1', false]])
    expect(intervals.idlessEndedGroups.has('sub-1')).toBe(true)
    applyToolIntervalEvent(intervals, subagentStop('sub-1'), 4)
    expect(intervals.idlessOpen).toEqual([])
    expect(intervals.idlessEndedGroups.has('sub-1')).toBe(false)
  })

  it('tool-end はほかのグループの区間を閉じない(自分のグループを集合に入れるだけ)', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), idlessToolEnd('sub-1')])
    expect(groupsOf(intervals)).toEqual([[null, false]])
    expect([...intervals.idlessEndedGroups]).toEqual(['sub-1'])
  })

  it('グループの中の新しいバッチは、そのグループの残りだけを閉じる(主の区間は閉じない)', () => {
    const intervals = createToolIntervals()
    run(intervals, [
      idlessToolStart(),
      idlessToolStart('sub-1'),
      idlessToolStart('sub-1'),
      idlessToolEnd('sub-1'),
      idlessToolStart('sub-1')
    ])
    expect(intervals.idlessOpen.map((interval) => [interval.group, interval.openedAt])).toEqual([
      [null, 0],
      ['sub-1', 4]
    ])
  })

  it('turn-end の後の最初のバッチは、前のターンの区間を閉じない(主は集合から外れている。サブエージェントの区間も残る)', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart('sub-1'), idlessToolStart(), idlessToolEnd(), turnEnd()])
    expect(groupsOf(intervals)).toEqual([['sub-1', false]])
    expect(intervals.idlessEndedGroups.has(null)).toBe(false)
    applyToolIntervalEvent(intervals, idlessToolStart(), 4)
    expect(groupsOf(intervals)).toEqual([
      ['sub-1', false],
      [null, false]
    ])
  })

  it('作業中に送ったプロンプト: 動いているツールに持ち越しの印が付き、そのツールの tool-end では閉じず、turn-end で閉じる', () => {
    const intervals = createToolIntervals()
    run(intervals, [idlessToolStart(), promptSubmit(), idlessToolEnd()])
    expect(groupsOf(intervals)).toEqual([[null, true]])
    run(intervals, [idlessToolStart(), idlessToolEnd()], 3)
    expect(groupsOf(intervals)).toEqual([[null, true]])
    applyToolIntervalEvent(intervals, turnEnd(), 5)
    expect(openCountOf(intervals)).toBe(0)
  })

  it('/clear(記録 91): session-end はすべてのグループの区間(持ち越しを含む)を閉じ、集合を空にする', () => {
    const intervals = createToolIntervals()
    run(intervals, [
      idlessToolStart(),
      idlessToolStart('sub-1'),
      idlessToolEnd('sub-1'),
      promptSubmit()
    ])
    applyToolIntervalEvent(intervals, sessionEnd(), 4)
    expect(intervals.idlessOpen).toEqual([])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })

  it(`ID を持たない区間が ${AGENT_TOOL_OPEN_MAX} 件ある間の tool-start は足さず(一番古い区間も捨てない)、overflowed を立てる`, () => {
    const intervals = createToolIntervals()
    for (let i = 0; i < AGENT_TOOL_OPEN_MAX; i++)
      applyToolIntervalEvent(intervals, idlessToolStart(), i)
    applyToolIntervalEvent(intervals, idlessToolStart(), 999)
    expect(intervals.idlessOpen).toHaveLength(AGENT_TOOL_OPEN_MAX)
    expect(intervals.idlessOpen[0].openedAt).toBe(0)
    expect(intervals.overflowed).toBe(true)
    expect(hasUnassignableInterval(intervals)).toBe(true)
  })

  it('ID を持たない区間も期限切れになり、earliestUnexpiredOpenedAt と hasUnassignableInterval に入る', () => {
    const intervals = createToolIntervals()
    applyToolIntervalEvent(intervals, idlessToolStart(), 100)
    applyToolIntervalEvent(intervals, idlessToolStart('sub-1'), 200)
    expect(earliestUnexpiredOpenedAt(intervals)).toBe(100)
    markExpiredIntervals(intervals, 150, 50)
    expect(intervals.idlessOpen.map((interval) => interval.expired)).toEqual([true, false])
    expect(earliestUnexpiredOpenedAt(intervals)).toBe(200)
    expect(hasUnassignableInterval(intervals)).toBe(true)
  })

  it('claude の知らせ(none を作らない)では idlessOpen・idlessEndedGroups は空のまま', () => {
    const intervals = createToolIntervals()
    run(intervals, [
      promptSubmit(),
      toolStart('a'),
      toolEnd('a'),
      batchEnd(),
      toolStart(null),
      toolEnd('x'),
      subagentStop('agent-1'),
      turnEnd(),
      sessionEnd()
    ])
    expect(intervals.idlessOpen).toEqual([])
    expect(intervals.idlessEndedGroups.size).toBe(0)
  })
})
