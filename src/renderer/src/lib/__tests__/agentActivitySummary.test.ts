import { describe, it, expect } from 'vitest'
import type { AgentActivity } from '../agentActivity'
import type { AgentSessionStatus } from '../agentSessionTabState'
import {
  describeAgentActivitySummary,
  formatAgentActivitySummary,
  needsAgentAttention,
  pickWaitingTab,
  summarizeAgentActivities
} from '../agentActivitySummary'

const tab = (
  slotId: string,
  status: AgentSessionStatus = 'running',
  isClosing = false
): { slotId: string; status: AgentSessionStatus; isClosing: boolean } => ({
  slotId,
  status,
  isClosing
})
const activitiesOf = (entries: [string, AgentActivity][]): ReadonlyMap<string, AgentActivity> =>
  new Map(entries)

describe('summarizeAgentActivities', () => {
  it('許可待ち → 確認待ち → 作業中 → 入力待ち → 実行中(不明) の順に、件数を数えて並べる', () => {
    const tabs = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => tab(id))
    const activities = activitiesOf([
      ['a', 'idle'],
      ['b', 'working'],
      ['c', 'unknown'],
      ['d', 'confirm'],
      ['e', 'working'],
      ['f', 'permission']
      // g は判定前(Map に無い)なので不明として数える
    ])
    expect(summarizeAgentActivities(tabs, activities)).toEqual([
      { activity: 'permission', count: 1 },
      { activity: 'confirm', count: 1 },
      { activity: 'working', count: 2 },
      { activity: 'idle', count: 1 },
      { activity: 'unknown', count: 2 }
    ])
  })

  it('0 件の活動は出さない', () => {
    const activities = activitiesOf([
      ['a', 'working'],
      ['b', 'working']
    ])
    expect(summarizeAgentActivities([tab('a'), tab('b')], activities)).toEqual([
      { activity: 'working', count: 2 }
    ])
  })

  it('running でないタブは数えない(活動が残っていても)', () => {
    const tabs = [tab('a', 'starting'), tab('b', 'exited'), tab('c', 'none'), tab('d')]
    const activities = activitiesOf([
      ['a', 'permission'],
      ['b', 'idle'],
      ['c', 'working'],
      ['d', 'idle']
    ])
    expect(summarizeAgentActivities(tabs, activities)).toEqual([{ activity: 'idle', count: 1 }])
  })

  it('閉じる途中のタブは数えない(status は running のままでも)。すべて閉じる途中なら空', () => {
    const activities = activitiesOf([
      ['a', 'idle'],
      ['b', 'working']
    ])
    expect(summarizeAgentActivities([tab('a', 'running', true), tab('b')], activities)).toEqual([
      { activity: 'working', count: 1 }
    ])
    expect(
      summarizeAgentActivities([tab('a', 'running', true), tab('b', 'running', true)], activities)
    ).toEqual([])
  })

  it('running のタブが無ければ空', () => {
    expect(summarizeAgentActivities([tab('a', 'none'), tab('b', 'starting')], new Map())).toEqual(
      []
    )
    expect(summarizeAgentActivities([], new Map())).toEqual([])
  })
})

describe('pickWaitingTab', () => {
  it('閉じる途中のタブは、選択中でも、より優先の活動でも選ばない', () => {
    const tabs = [tab('a', 'running', true), tab('b'), tab('c', 'running', true)]
    const activities = activitiesOf([
      ['a', 'idle'],
      ['b', 'idle'],
      ['c', 'permission']
    ])
    expect(pickWaitingTab(tabs, activities, 'a')).toBe('b')
    expect(pickWaitingTab([tab('a', 'running', true)], activities, 'a')).toBeNull()
  })

  it('許可待ち → 確認待ち → 入力待ち の順で、最初に当たるタブを選ぶ', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    expect(
      pickWaitingTab(
        tabs,
        activitiesOf([
          ['a', 'idle'],
          ['b', 'confirm'],
          ['c', 'permission']
        ]),
        null
      )
    ).toBe('c')
    expect(
      pickWaitingTab(
        tabs,
        activitiesOf([
          ['a', 'idle'],
          ['b', 'confirm'],
          ['c', 'working']
        ]),
        null
      )
    ).toBe('b')
    expect(
      pickWaitingTab(
        tabs,
        activitiesOf([
          ['a', 'working'],
          ['b', 'idle'],
          ['c', 'unknown']
        ]),
        null
      )
    ).toBe('b')
  })

  // 選ぶ優先はまとめの並びと同じ(並び順の知識を 1 か所に置く)
  it('利用者を待っている活動の 2 つを比べると、まとめで先に並ぶ方のタブを選ぶ', () => {
    const waiting: AgentActivity[] = ['permission', 'confirm', 'idle']
    for (const first of waiting) {
      for (const second of waiting) {
        if (first === second) continue
        const tabs = [tab('a'), tab('b')]
        const activities = activitiesOf([
          ['a', first],
          ['b', second]
        ])
        const order = summarizeAgentActivities(tabs, activities).map((item) => item.activity)
        const expected = order.indexOf(first) < order.indexOf(second) ? 'a' : 'b'
        expect(pickWaitingTab(tabs, activities, null)).toBe(expected)
      }
    }
  })

  it('同じ活動のタブが複数あれば、並びの先頭を選ぶ', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    const activities = activitiesOf([
      ['a', 'working'],
      ['b', 'permission'],
      ['c', 'permission']
    ])
    expect(pickWaitingTab(tabs, activities, null)).toBe('b')
  })

  // 入力待ちは複数のタブで同時に起きやすい。押すたびに見ていたタブから外れないよう、同じ活動なら選択中のタブを選ぶ
  it('選択中のタブが同じ活動なら、並びの先頭より選択中のタブを選ぶ', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    const activities = activitiesOf([
      ['a', 'idle'],
      ['b', 'working'],
      ['c', 'idle']
    ])
    expect(pickWaitingTab(tabs, activities, 'c')).toBe('c')
    // 選択中のタブが当たらなければ(作業中)、並びの先頭
    expect(pickWaitingTab(tabs, activities, 'b')).toBe('a')
  })

  it('選択中のタブより優先の活動のタブがあれば、そちらを選ぶ', () => {
    const tabs = [tab('a'), tab('b'), tab('c')]
    const activities = activitiesOf([
      ['a', 'idle'],
      ['b', 'permission'],
      ['c', 'idle']
    ])
    expect(pickWaitingTab(tabs, activities, 'c')).toBe('b')
  })

  it('選択中のタブが running でなければ、活動が入っていても選ばない', () => {
    const tabs = [tab('a'), tab('b', 'exited')]
    const activities = activitiesOf([
      ['a', 'idle'],
      ['b', 'idle']
    ])
    expect(pickWaitingTab(tabs, activities, 'b')).toBe('a')
  })

  it('running でないタブは選ばない', () => {
    const tabs = [tab('a', 'exited'), tab('b')]
    const activities = activitiesOf([
      ['a', 'permission'],
      ['b', 'idle']
    ])
    expect(pickWaitingTab(tabs, activities, null)).toBe('b')
  })

  it('当たるタブが無ければ null(作業中・実行中だけ、running のタブが無い)', () => {
    expect(
      pickWaitingTab(
        [tab('a'), tab('b')],
        activitiesOf([
          ['a', 'working'],
          ['b', 'unknown']
        ]),
        null
      )
    ).toBeNull()
    expect(pickWaitingTab([tab('a', 'none')], new Map(), null)).toBeNull()
  })
})

describe('needsAgentAttention', () => {
  it('許可待ちか確認待ちが 1 つでもあれば true', () => {
    expect(needsAgentAttention([{ activity: 'permission', count: 1 }])).toBe(true)
    expect(
      needsAgentAttention([
        { activity: 'confirm', count: 1 },
        { activity: 'working', count: 1 }
      ])
    ).toBe(true)
  })

  it('作業中・入力待ち・実行中だけなら false', () => {
    expect(
      needsAgentAttention([
        { activity: 'working', count: 1 },
        { activity: 'idle', count: 2 },
        { activity: 'unknown', count: 1 }
      ])
    ).toBe(false)
    expect(needsAgentAttention([])).toBe(false)
  })
})

describe('まとめの文言', () => {
  const items = [
    { activity: 'permission' as const, count: 1 },
    { activity: 'working' as const, count: 2 }
  ]

  it('表示は「エージェント: 許可待ち 1 · 作業中 2」', () => {
    expect(formatAgentActivitySummary(items)).toBe('エージェント: 許可待ち 1 · 作業中 2')
  })

  it('不明は「実行中」と表示する', () => {
    expect(formatAgentActivitySummary([{ activity: 'unknown', count: 3 }])).toBe(
      'エージェント: 実行中 3'
    )
  })

  it('aria-label は見える文字そのまま +「（押すとターミナルを開きます）」', () => {
    expect(describeAgentActivitySummary(items)).toBe(
      'エージェント: 許可待ち 1 · 作業中 2（押すとターミナルを開きます）'
    )
    expect(describeAgentActivitySummary(items).startsWith(formatAgentActivitySummary(items))).toBe(
      true
    )
  })
})
