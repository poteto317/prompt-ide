import { describe, it, expect, expectTypeOf } from 'vitest'
import type { AgentNotificationShowRequest } from '@shared/types'
import { agentNotificationText } from '@shared/agentNotificationText'
import type { AgentActivity } from '../agentActivity'
import type {
  AgentNotificationEvent,
  AgentNotificationKind,
  AgentNotificationTab
} from '../agentNotificationEvents'
import {
  advanceAgentNotifications,
  countAgentTabsWaitingForUser,
  findRemovedAgentNotificationTabs,
  formatAgentNotificationAnnouncement,
  nextAgentNotification
} from '../agentNotificationEvents'

/** 起動の直後(記録なし)から活動を順に流し、知らせた出来事を並べる */
function replay(activities: readonly AgentActivity[]): AgentNotificationKind[] {
  let settled: AgentActivity | null = null
  const kinds: AgentNotificationKind[] = []
  for (const activity of activities) {
    const decision = nextAgentNotification(settled, activity)
    settled = decision.settled
    if (decision.kind !== null) kinds.push(decision.kind)
  }
  return kinds
}

describe('nextAgentNotification', () => {
  it.each<
    [AgentActivity | null, AgentActivity, AgentNotificationKind | null, AgentActivity | null]
  >([
    // 許可待ち: permission 以外 → permission
    ['working', 'permission', 'permission', 'permission'],
    ['idle', 'permission', 'permission', 'permission'],
    ['confirm', 'permission', 'permission', 'permission'],
    // 確認待ち: confirm 以外 → confirm
    ['working', 'confirm', 'confirm', 'confirm'],
    ['permission', 'confirm', 'confirm', 'confirm'],
    // 作業の完了: working → idle だけ
    ['working', 'idle', 'done', 'idle'],
    ['permission', 'idle', null, 'idle'],
    ['confirm', 'idle', null, 'idle'],
    // 同じ活動が続く間は 1 回だけ
    ['permission', 'permission', null, 'permission'],
    ['confirm', 'confirm', null, 'confirm'],
    ['idle', 'idle', null, 'idle'],
    // 作業中になっただけでは知らせない
    ['idle', 'working', null, 'working'],
    // unknown は最後の確かな活動を変えない
    ['working', 'unknown', null, 'working'],
    [null, 'unknown', null, null],
    // 起動の直後: idle は知らせず、confirm・permission は知らせる
    [null, 'idle', null, 'idle'],
    [null, 'confirm', 'confirm', 'confirm'],
    [null, 'permission', 'permission', 'permission'],
    [null, 'working', null, 'working']
  ])('%s → %s は %s(次に覚えるのは %s)', (lastSettled, next, kind, settled) => {
    expect(nextAgentNotification(lastSettled, next)).toEqual({ kind, settled })
  })

  it('unknown を挟んだ working → unknown → permission は許可待ちとして知らせる', () => {
    expect(replay(['working', 'unknown', 'permission'])).toEqual(['permission'])
  })

  it('working → unknown → idle は作業の完了として知らせる', () => {
    expect(replay(['working', 'unknown', 'idle'])).toEqual(['done'])
  })

  it('permission → unknown → permission は 1 回だけ知らせる', () => {
    expect(replay(['permission', 'unknown', 'permission'])).toEqual(['permission'])
  })

  it('permission → working → permission は 2 回目も知らせる', () => {
    expect(replay(['permission', 'working', 'permission'])).toEqual(['permission', 'permission'])
  })

  it('起動の直後の idle は知らせず、その後の作業の完了は知らせる', () => {
    expect(replay(['idle', 'working', 'idle'])).toEqual(['done'])
  })
})

const tab = (n: number, overrides: Partial<AgentNotificationTab> = {}): AgentNotificationTab => ({
  slotId: `slot-${n}`,
  number: n,
  status: 'running',
  isClosing: false,
  ...overrides
})

describe('advanceAgentNotifications', () => {
  it('タブごとに最後の確かな活動を進め、知らせる出来事をタブの番号と並べる', () => {
    const { settled, events } = advanceAgentNotifications(
      new Map<string, AgentActivity>([
        ['slot-1', 'working'],
        ['slot-2', 'working']
      ]),
      [tab(1), tab(2)],
      new Map<string, AgentActivity>([
        ['slot-1', 'idle'],
        ['slot-2', 'permission']
      ])
    )
    expect(events).toEqual([
      { slotId: 'slot-1', tabNumber: 1, kind: 'done' },
      { slotId: 'slot-2', tabNumber: 2, kind: 'permission' }
    ])
    expect([...settled]).toEqual([
      ['slot-1', 'idle'],
      ['slot-2', 'permission']
    ])
  })

  it('活動が無いタブは unknown として扱い、記録を変えない', () => {
    const { settled, events } = advanceAgentNotifications(
      new Map<string, AgentActivity>([['slot-1', 'working']]),
      [tab(1)],
      new Map()
    )
    expect(events).toEqual([])
    expect(settled.get('slot-1')).toBe('working')
  })

  it('消えたタブ・running でないタブの記録を消す(再起動の直後の idle を完了と誤って知らせない)', () => {
    const previous = new Map<string, AgentActivity>([
      ['slot-1', 'working'],
      ['slot-2', 'working']
    ])
    const { settled, events } = advanceAgentNotifications(
      previous,
      [tab(1, { status: 'exited' })],
      new Map<string, AgentActivity>([['slot-1', 'idle']])
    )
    expect(events).toEqual([])
    expect(settled.size).toBe(0)
  })

  it('閉じる途中のタブは記録だけ進めて知らせない', () => {
    const { settled, events } = advanceAgentNotifications(
      new Map<string, AgentActivity>([['slot-1', 'working']]),
      [tab(1, { isClosing: true })],
      new Map<string, AgentActivity>([['slot-1', 'permission']])
    )
    expect(events).toEqual([])
    expect(settled.get('slot-1')).toBe('permission')
  })

  it('最後の確かな活動が permission・confirm から working・idle へ変わったタブを、待っている状態が終わったタブとして並び順で返す', () => {
    const { events, finishedWaiting } = advanceAgentNotifications(
      new Map<string, AgentActivity>([
        ['slot-1', 'permission'],
        ['slot-2', 'confirm'],
        ['slot-3', 'permission'],
        ['slot-4', 'permission']
      ]),
      [tab(1), tab(2), tab(3), tab(4)],
      new Map<string, AgentActivity>([
        ['slot-1', 'working'],
        ['slot-2', 'idle'],
        ['slot-3', 'unknown'],
        ['slot-4', 'permission']
      ])
    )
    // permission → idle は作業の完了ではないので知らせない。unknown は判定できなかっただけ・同じ活動のままは終わっていない
    expect(events).toEqual([])
    expect(finishedWaiting).toEqual(['slot-1', 'slot-2'])
  })

  it('待っている状態の間の移り変わり・作業の完了(done)・起動の直後は、待っている状態が終わったとしない', () => {
    const { events, finishedWaiting } = advanceAgentNotifications(
      new Map<string, AgentActivity>([
        ['slot-1', 'permission'],
        ['slot-2', 'working']
      ]),
      [tab(1), tab(2), tab(3)],
      new Map<string, AgentActivity>([
        ['slot-1', 'confirm'],
        ['slot-2', 'idle'],
        ['slot-3', 'idle']
      ])
    )
    expect(events).toEqual([
      { slotId: 'slot-1', tabNumber: 1, kind: 'confirm' },
      { slotId: 'slot-2', tabNumber: 2, kind: 'done' }
    ])
    expect(finishedWaiting).toEqual([])
  })

  it('閉じる途中のタブも、待っている状態が終わったとする(知らせはしないが、残った通知は閉じる)', () => {
    const { finishedWaiting } = advanceAgentNotifications(
      new Map<string, AgentActivity>([['slot-1', 'permission']]),
      [tab(1, { isClosing: true })],
      new Map<string, AgentActivity>([['slot-1', 'working']])
    )
    expect(finishedWaiting).toEqual(['slot-1'])
  })

  it('許可待ち・確認待ちのまま running でなくなった(終了した)タブも、待っている状態が終わったとする。idle・working のまま終了したタブは含まない', () => {
    const { events, finishedWaiting, settled } = advanceAgentNotifications(
      new Map<string, AgentActivity>([
        ['slot-1', 'permission'],
        ['slot-2', 'confirm'],
        ['slot-3', 'idle'],
        ['slot-4', 'working']
      ]),
      [
        tab(1, { status: 'exited' }),
        tab(2, { status: 'exited' }),
        tab(3, { status: 'exited' }),
        tab(4, { status: 'exited' })
      ],
      new Map<string, AgentActivity>()
    )
    expect(events).toEqual([])
    expect(finishedWaiting).toEqual(['slot-1', 'slot-2'])
    // 記録は消える(次の回は前の記録が無いので、閉じる依頼を重ねて送らない)
    expect(settled.size).toBe(0)
  })

  it('渡された記録の Map は書き換えない', () => {
    const previous = new Map<string, AgentActivity>([['slot-1', 'working']])
    advanceAgentNotifications(
      previous,
      [tab(1)],
      new Map<string, AgentActivity>([['slot-1', 'idle']])
    )
    expect([...previous]).toEqual([['slot-1', 'working']])
  })
})

describe('findRemovedAgentNotificationTabs', () => {
  it('前の一覧にあって今の一覧に無いタブの slotId を、前の並び順で返す', () => {
    expect(findRemovedAgentNotificationTabs([tab(1), tab(2), tab(3)], [tab(2)])).toEqual([
      'slot-1',
      'slot-3'
    ])
  })

  it('running でない・閉じる途中のタブも、一覧に残っていれば消えたとしない(通知は閉じたタブだけ消す)', () => {
    expect(
      findRemovedAgentNotificationTabs(
        [tab(1), tab(2)],
        [tab(1, { status: 'exited' }), tab(2, { isClosing: true })]
      )
    ).toEqual([])
  })

  it('同じ番号でも slotId が違えば、前のタブは消えたとする(番号は使い回される)', () => {
    expect(findRemovedAgentNotificationTabs([tab(2)], [{ ...tab(2), slotId: 'slot-2b' }])).toEqual([
      'slot-2'
    ])
  })
})

describe('countAgentTabsWaitingForUser', () => {
  it('最後の確かな活動が permission・confirm の、running で閉じる途中でないタブを数える', () => {
    const settled = new Map<string, AgentActivity>([
      ['slot-1', 'permission'],
      ['slot-2', 'confirm'],
      ['slot-3', 'idle'],
      ['slot-4', 'permission'],
      ['slot-5', 'confirm']
    ])
    expect(
      countAgentTabsWaitingForUser(
        [tab(1), tab(2), tab(3), tab(4, { isClosing: true }), tab(5, { status: 'exited' }), tab(6)],
        settled
      )
    ).toBe(2)
  })
})

describe('AgentNotificationEvent', () => {
  it('出来事は IPC の型とは別に持ち、そのまま OS の通知の依頼として送れる', () => {
    expectTypeOf(advanceAgentNotifications)
      .returns.toHaveProperty('events')
      .toEqualTypeOf<AgentNotificationEvent[]>()
    expectTypeOf<AgentNotificationEvent>().toExtend<AgentNotificationShowRequest>()
  })
})

describe('formatAgentNotificationAnnouncement', () => {
  // 文言そのものは agentNotificationText のテストで固定し、ここではつなぎ方だけを見る(文言の変更を 1 か所に閉じる)
  const said = (kind: AgentNotificationKind, tabNumber: number): string =>
    agentNotificationText(kind, tabNumber).announcement

  it('出来事ごとの読み上げの文言を、タブの並び順のまま「。」でつなぐ', () => {
    expect(
      formatAgentNotificationAnnouncement([
        { slotId: 'slot-1', tabNumber: 1, kind: 'permission' },
        { slotId: 'slot-2', tabNumber: 2, kind: 'done' },
        { slotId: 'slot-3', tabNumber: 3, kind: 'confirm' }
      ])
    ).toBe(`${said('permission', 1)}。${said('done', 2)}。${said('confirm', 3)}`)
  })

  it('出来事が 1 件なら区切りを付けない', () => {
    expect(
      formatAgentNotificationAnnouncement([{ slotId: 'slot-4', tabNumber: 4, kind: 'done' }])
    ).toBe(said('done', 4))
  })
})
