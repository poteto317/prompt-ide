import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS,
  AGENT_TOOL_END_GRACE_MS,
  AGENT_TOOL_INTERVAL_MAX_MS,
  createAgentToolActivity
} from '../agentToolActivity'
import { AGENT_DROPPED_TOOL_IDS_MAX, AGENT_TOOL_OPEN_MAX } from '../agentToolIntervals'
import type { AgentToolActivity, AgentToolActivityDeps } from '../agentToolActivity'
import {
  promptSubmit,
  sessionEnd,
  subagentStop,
  toolEnd,
  toolStart,
  turnEnd
} from './helpers/agentHookEventFixtures'

let onPhaseChange: ReturnType<typeof vi.fn<AgentToolActivityDeps['onPhaseChange']>>
let devLog: ReturnType<typeof vi.fn<(line: string) => void>>
let warn: ReturnType<typeof vi.fn<AgentToolActivityDeps['warn']>>
let tracker: AgentToolActivity

beforeEach(() => {
  vi.useFakeTimers()
  onPhaseChange = vi.fn()
  devLog = vi.fn()
  warn = vi.fn()
  tracker = createAgentToolActivity({ onPhaseChange, devLog, warn })
})

afterEach(() => {
  tracker.close()
  vi.useRealTimers()
})

const phase = (ownerId = 1): string => tracker.activityOf(ownerId).phase
/** pending で足し、プロンプトの知らせで confirmed にする */
const confirmed = (ownerId = 1, sessionId = 's1'): void => {
  tracker.addSession(ownerId, sessionId, { kind: 'pending' })
  tracker.deliver(ownerId, sessionId, promptSubmit())
}
/** 区間がすべて閉じた後の猶予を過ぎる */
const passGrace = (): void => {
  vi.advanceTimersByTime(AGENT_TOOL_END_GRACE_MS)
}

describe('createAgentToolActivity(定数)', () => {
  it('設計書の値', () => {
    expect(AGENT_TOOL_END_GRACE_MS).toBe(2_000)
    expect(AGENT_TOOL_INTERVAL_MAX_MS).toBe(15 * 60 * 1000)
    expect(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS).toBe(15_000)
  })
})

describe('createAgentToolActivity(あるべき段階)', () => {
  it('セッションの無い所有者は paused(合図なし)', () => {
    expect(tracker.activityOf(1)).toEqual({ phase: 'paused', lost: null, unassignable: false })
  })

  it('pending のセッションがあれば agent。プロンプトの知らせで confirmed・idle になる', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: null, unassignable: false })
    expect(onPhaseChange).toHaveBeenCalledExactlyOnceWith(1)
    tracker.deliver(1, 's1', promptSubmit())
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
    expect(onPhaseChange).toHaveBeenCalledTimes(2)
  })

  it('最初の知らせが PreToolUse なら、pending の agent から confirmed の agent で変わらず、onPhaseChange を呼ばない', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    onPhaseChange.mockClear()
    tracker.deliver(1, 's1', toolStart('a'))
    expect(phase()).toBe('agent')
    expect(onPhaseChange).not.toHaveBeenCalled()
  })

  it('hooks なしで起動した(unconfirmed)セッションがあれば、区別をやめる合図と agent', () => {
    confirmed()
    tracker.addSession(1, 's2', { kind: 'unconfirmed', reason: 'claude-version-unsupported' })
    expect(tracker.activityOf(1)).toEqual({
      phase: 'agent',
      lost: 'claude-version-unsupported',
      unassignable: false
    })
    tracker.removeSession(1, 's2')
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
  })

  it('pending と confirmed が混ざれば agent。confirmed が 1 つも無くなれば paused(猶予の間でも)', () => {
    confirmed(1, 's1')
    tracker.addSession(1, 's2', { kind: 'pending' })
    expect(phase()).toBe('agent')
    tracker.removeSession(1, 's2')
    expect(phase()).toBe('idle')
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolEnd('a'))
    expect(phase()).toBe('agent')
    tracker.removeSession(1, 's1')
    expect(phase()).toBe('paused')
  })

  it('所有者ごとに独立している', () => {
    confirmed(1, 's1')
    confirmed(2, 's2')
    tracker.deliver(1, 's1', toolStart('a'))
    expect(phase(1)).toBe('agent')
    expect(phase(2)).toBe('idle')
  })

  it('変わったときだけ onPhaseChange を呼ぶ', () => {
    confirmed()
    onPhaseChange.mockClear()
    tracker.deliver(1, 's1', promptSubmit())
    tracker.deliver(1, 's1', turnEnd())
    expect(onPhaseChange).not.toHaveBeenCalled()
  })
})

describe('createAgentToolActivity(区間と猶予)', () => {
  it('区間が閉じてから 2 秒は agent、その後 idle', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolEnd('a'))
    vi.advanceTimersByTime(AGENT_TOOL_END_GRACE_MS - 1)
    expect(phase()).toBe('agent')
    vi.advanceTimersByTime(1)
    expect(phase()).toBe('idle')
  })

  it('猶予の間の tool-start で猶予を取り消し、段階は agent のまま変わらない', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolEnd('a'))
    vi.advanceTimersByTime(1_000)
    onPhaseChange.mockClear()
    tracker.deliver(1, 's1', toolStart('b'))
    vi.advanceTimersByTime(10_000)
    expect(phase()).toBe('agent')
    expect(onPhaseChange).not.toHaveBeenCalled()
    // 取り消した猶予の終わりは来ない
    expect(devLog.mock.calls.some(([line]) => line.includes('event=猶予の終わり'))).toBe(false)
    tracker.deliver(1, 's1', toolEnd('b'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('同じ ID の tool-start が 2 回でも区間は 1 つ', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolEnd('a'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('同じ ID の 2 回目の tool-start は最初の区間を上書きしない(開いた時刻は最初のまま)', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS / 2)
    tracker.deliver(1, 's1', toolStart('a'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS / 2)
    expect(tracker.activityOf(1).unassignable).toBe(true)
  })

  it('別のセッションの区間が開いていれば agent(同じウィンドウのタブは記録を共有する)', () => {
    confirmed(1, 's1')
    confirmed(1, 's2')
    tracker.deliver(1, 's2', toolStart('a'))
    passGrace()
    expect(phase()).toBe('agent')
  })

  it('turn-end は ID があって agent_id の無い区間だけを閉じ、agent_id のある区間と ID なしの区間は残す', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('main'))
    tracker.deliver(1, 's1', toolStart('sub', 'ag-1'))
    tracker.deliver(1, 's1', toolStart(null))
    tracker.deliver(1, 's1', turnEnd())
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', toolEnd('sub', 'ag-1'))
    passGrace()
    // ID なしの区間が残る
    expect(phase()).toBe('agent')
  })

  it('turn-end は agent_id のある区間を閉じず、外した ID としても控えない(背景のサブエージェントの区間は残る)', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('sub', 'ag-1'))
    tracker.deliver(1, 's1', turnEnd())
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', toolEnd('sub', 'ag-1'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('subagent-stop はその agent_id の区間だけを閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('x', 'ag-1'))
    tracker.deliver(1, 's1', toolStart('y', 'ag-2'))
    tracker.deliver(1, 's1', subagentStop('ag-1'))
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', subagentStop('ag-2'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('外した ID の遅れた tool-end は、ID なしの区間を閉じない', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart(null))
    tracker.deliver(1, 's1', toolStart('a'))
    // a は turn-end で外した ID
    tracker.deliver(1, 's1', turnEnd())
    tracker.deliver(1, 's1', toolEnd('a'))
    passGrace()
    expect(phase()).toBe('agent')
  })

  it('読めない ID の tool-end は何も閉じない', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart(null))
    tracker.deliver(1, 's1', toolEnd(null))
    passGrace()
    expect(phase()).toBe('agent')
  })

  it('どこにも無い読めた ID の tool-end は、PreToolUse を読めなかった区間の終わりとみなして閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart(null))
    tracker.deliver(1, 's1', toolEnd('zzz'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('外した ID の控えは 1 回で消え、2 回目の同じ ID は ID なしの区間を閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', turnEnd())
    tracker.deliver(1, 's1', toolStart(null))
    tracker.deliver(1, 's1', toolEnd('a'))
    passGrace()
    expect(phase()).toBe('agent')
    tracker.deliver(1, 's1', toolEnd('a'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('session-end はすべての区間(ID なしを含む)を閉じ、セッションと確かめた状態は残す(/clear の後の知らせを受け付ける)', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolStart(null))
    tracker.deliver(1, 's1', sessionEnd())
    passGrace()
    expect(phase()).toBe('idle')
    tracker.deliver(1, 's1', toolStart('b'))
    expect(phase()).toBe('agent')
    // session-end で外した a の遅れた知らせは、別の ID なしの区間を閉じない
    tracker.deliver(1, 's1', toolStart(null))
    tracker.deliver(1, 's1', toolEnd('b'))
    tracker.deliver(1, 's1', toolEnd('a'))
    passGrace()
    expect(phase()).toBe('agent')
  })

  it('pty の終了(removeSession)で区間ごとセッションを外す', () => {
    confirmed(1, 's1')
    confirmed(1, 's2')
    tracker.deliver(1, 's1', toolStart(null))
    tracker.removeSession(1, 's1')
    expect(phase()).toBe('agent')
    passGrace()
    expect(phase()).toBe('idle')
  })

  it(`開いた区間は ${AGENT_TOOL_OPEN_MAX} 件まで。超えたら一番古い ID を外し、外した ID として控える`, () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart(null))
    for (let i = 0; i <= AGENT_TOOL_OPEN_MAX; i++) tracker.deliver(1, 's1', toolStart(`id-${i}`))
    // id-0 は上限で外れた。遅れた知らせで ID なしの区間を閉じない
    tracker.deliver(1, 's1', toolEnd('id-0'))
    for (let i = 1; i <= AGENT_TOOL_OPEN_MAX; i++) tracker.deliver(1, 's1', toolEnd(`id-${i}`))
    passGrace()
    expect(phase()).toBe('agent')
  })

  it(`外した ID の控えは ${AGENT_DROPPED_TOOL_IDS_MAX} 件まで。超えたら古い方から捨てる`, () => {
    confirmed()
    for (let i = 0; i <= AGENT_DROPPED_TOOL_IDS_MAX; i++) {
      tracker.deliver(1, 's1', toolStart(`id-${i}`))
      tracker.deliver(1, 's1', turnEnd())
    }
    tracker.deliver(1, 's1', toolStart(null))
    // id-1 はまだ控えにある(何も閉じない)
    tracker.deliver(1, 's1', toolEnd('id-1'))
    passGrace()
    expect(phase()).toBe('agent')
    // id-0 は控えから捨てられたため、どこにも無い ID として ID なしの区間を閉じる
    tracker.deliver(1, 's1', toolEnd('id-0'))
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('ツールの開始の通し番号は tool-start のたびに増え、セッションが 0 になっても戻らない', () => {
    confirmed()
    expect(tracker.toolStartSeqOf(1)).toBe(0)
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolStart(null))
    expect(tracker.toolStartSeqOf(1)).toBe(3)
    expect(tracker.toolStartSeqOf(2)).toBe(0)
    tracker.removeSession(1, 's1')
    expect(tracker.toolStartSeqOf(1)).toBe(3)
  })

  it('登録されていないセッションの知らせは捨てる', () => {
    tracker.deliver(1, 'unknown', toolStart('a'))
    expect(tracker.activityOf(1)).toEqual({ phase: 'paused', lost: null, unassignable: false })
    expect(tracker.toolStartSeqOf(1)).toBe(0)
  })
})

describe('createAgentToolActivity(期限切れ)', () => {
  it('15 分を超えた区間は外さずに期限切れにし、合図 unassignable を立てる。自分の閉じ方(turn-end)で閉じて下ろす', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS - 1)
    expect(tracker.activityOf(1).unassignable).toBe(false)
    onPhaseChange.mockClear()
    vi.advanceTimersByTime(1)
    expect(tracker.activityOf(1)).toEqual({ phase: 'agent', lost: null, unassignable: true })
    expect(onPhaseChange).toHaveBeenCalledExactlyOnceWith(1)
    expect(devLog.mock.calls.some(([line]) => line.includes('event=interval-expired'))).toBe(true)
    tracker.deliver(1, 's1', turnEnd())
    expect(tracker.activityOf(1).unassignable).toBe(false)
    passGrace()
    expect(phase()).toBe('idle')
  })

  it('agent_id のある期限切れの区間はメインの turn-end では閉じず、同じ agent_id の subagent-stop で閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a', 'ag-1'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    tracker.deliver(1, 's1', turnEnd())
    expect(tracker.activityOf(1).unassignable).toBe(true)
    tracker.deliver(1, 's1', subagentStop('ag-1'))
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('ID なしの期限切れの区間は turn-end では閉じず、session-end で閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart(null))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    tracker.deliver(1, 's1', turnEnd())
    expect(tracker.activityOf(1).unassignable).toBe(true)
    tracker.deliver(1, 's1', sessionEnd())
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('期限切れの区間は自分の tool-end で閉じる', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    expect(tracker.activityOf(1).unassignable).toBe(true)
    tracker.deliver(1, 's1', toolEnd('a'))
    expect(tracker.activityOf(1).unassignable).toBe(false)
  })

  it('期限切れの区間は pty の終了(removeSession)で閉じる。ほかのセッションの区間は残す', () => {
    confirmed(1, 's1')
    confirmed(1, 's2')
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's2', toolStart(null))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    tracker.removeSession(1, 's2')
    expect(tracker.activityOf(1).unassignable).toBe(true)
    tracker.removeSession(1, 's1')
    expect(tracker.activityOf(1)).toEqual({ phase: 'paused', lost: null, unassignable: false })
  })

  it('unassignable は段階の分岐と別に求める(区別をやめる合図と同時に立つ)', () => {
    confirmed(1, 's1')
    tracker.deliver(1, 's1', toolStart('a'))
    vi.advanceTimersByTime(AGENT_TOOL_INTERVAL_MAX_MS)
    tracker.addSession(1, 's2', { kind: 'unconfirmed', reason: 'receiver-unavailable' })
    expect(tracker.activityOf(1)).toEqual({
      phase: 'agent',
      lost: 'receiver-unavailable',
      unassignable: true
    })
  })
})

describe('createAgentToolActivity(作業中の知らせと確かめた状態)', () => {
  it('pending の間の作業中の知らせから 15 秒、知らせが届かなければ unconfirmed(hooks-not-confirmed)にしてログに出す', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS - 1)
    expect(tracker.activityOf(1).lost).toBeNull()
    vi.advanceTimersByTime(1)
    expect(tracker.activityOf(1)).toEqual({
      phase: 'agent',
      lost: 'hooks-not-confirmed',
      unassignable: false
    })
    expect(warn).toHaveBeenCalledWith('[agent-hooks] hooks の知らせが届かないため、区別をやめます')
  })

  it('15 秒の間にどれかの知らせが届けばタイマーを外し、confirmed のまま', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(10_000)
    tracker.deliver(1, 's1', turnEnd())
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
  })

  it('2 回目の作業中の知らせではタイマーを張り直さない', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(10_000)
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(5_000)
    expect(tracker.activityOf(1).lost).toBe('hooks-not-confirmed')
  })

  it('confirmed のセッションへの作業中の知らせは何もしない', () => {
    confirmed()
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
    expect(tracker.activityOf(1).lost).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('別のウィンドウのセッション・知らないセッションの作業中の知らせは捨ててログに出す', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(2, 's1')
    tracker.reportWorking(1, 'unknown')
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
    expect(tracker.activityOf(1).lost).toBeNull()
    expect(warn).toHaveBeenCalledTimes(2)
    expect(warn).toHaveBeenCalledWith('[agent-hooks] 作業中の知らせのセッションが見つかりません')
  })

  it('unconfirmed(hooks-not-confirmed)の後に知らせが届けば confirmed に戻す', () => {
    tracker.addSession(1, 's1', { kind: 'pending' })
    tracker.reportWorking(1, 's1')
    vi.advanceTimersByTime(AGENT_HOOKS_UNCONFIRMED_AFTER_WORKING_MS)
    tracker.deliver(1, 's1', promptSubmit())
    expect(tracker.activityOf(1)).toEqual({ phase: 'idle', lost: null, unassignable: false })
  })
})

describe('createAgentToolActivity(ログと後始末)', () => {
  it('開発版のログに 1 行ずつ出す(トークン・本文は無い)', () => {
    tracker.addSession(1, 'abcdefgh-1234', { kind: 'pending' })
    tracker.deliver(1, 'abcdefgh-1234', toolStart('toolu_1'))
    expect(devLog.mock.calls.map(([line]) => line)).toEqual([
      '[agent-hooks] owner=1 session=abcdefgh event=起動 tool=- id=- agent=- hooks=pending phase=paused→agent',
      '[agent-hooks] owner=1 session=abcdefgh event=PreToolUse tool=Edit id=あり agent=なし hooks=confirmed phase=agent→agent'
    ])
  })

  it('devLog が null なら出さない', () => {
    const quiet = createAgentToolActivity({ onPhaseChange, devLog: null, warn })
    quiet.addSession(1, 's1', { kind: 'pending' })
    expect(devLog).not.toHaveBeenCalled()
    quiet.close()
  })

  it('close でタイマーが残らず、onPhaseChange を呼ばない', () => {
    confirmed()
    tracker.deliver(1, 's1', toolStart('a'))
    tracker.deliver(1, 's1', toolStart('b'))
    tracker.deliver(1, 's1', toolEnd('a'))
    tracker.addSession(1, 's2', { kind: 'pending' })
    tracker.reportWorking(1, 's2')
    onPhaseChange.mockClear()
    tracker.close()
    expect(vi.getTimerCount()).toBe(0)
    expect(onPhaseChange).not.toHaveBeenCalled()
  })
})
