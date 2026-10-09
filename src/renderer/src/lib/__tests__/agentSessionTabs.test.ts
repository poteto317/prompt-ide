import { describe, it, expect, vi } from 'vitest'
import { createAgentSessionTabs } from '../agentSessionTabs'
import type { AgentTerminalController } from '../agentTerminalController'

const fakeController = (): AgentTerminalController =>
  ({ dispose: vi.fn() }) as unknown as AgentTerminalController

function setup(max = 4): { tabs: ReturnType<typeof createAgentSessionTabs> } {
  let next = 0
  const tabs = createAgentSessionTabs({
    createController: vi.fn(fakeController),
    createSlotId: () => `slot-${++next}`,
    max
  })
  return { tabs }
}

describe('createAgentSessionTabs', () => {
  it('初期状態はタブ 1 つ(番号 1)で、それを選択している', () => {
    const { tabs } = setup()
    const snapshot = tabs.getSnapshot()
    expect(snapshot.tabs.map((tab) => [tab.slotId, tab.number])).toEqual([['slot-1', 1]])
    expect(snapshot.selectedSlotId).toBe('slot-1')
  })

  it('add はタブを作って選択し、上限で null を返す', () => {
    const { tabs } = setup(2)
    const added = tabs.add()
    expect(added?.number).toBe(2)
    expect(tabs.getSnapshot().selectedSlotId).toBe(added?.slotId)
    expect(tabs.add()).toBeNull()
    expect(tabs.getSnapshot().tabs).toHaveLength(2)
  })

  it('番号は使われていない最小の番号を使う', () => {
    const { tabs } = setup()
    tabs.add() // 2
    const third = tabs.add() // 3
    tabs.remove('slot-2')
    expect(tabs.add()?.number).toBe(2)
    expect(third?.number).toBe(3)
  })

  it('remove は controller を dispose し、選択中なら左隣を選ぶ', () => {
    const { tabs } = setup()
    tabs.add() // slot-2
    const third = tabs.add()! // slot-3(選択中)
    expect(tabs.remove('slot-3')).toBe(true)
    expect(third.controller.dispose).toHaveBeenCalledTimes(1)
    expect(tabs.getSnapshot().selectedSlotId).toBe('slot-2')
  })

  it('3 つあって中央の選択中のタブを消すと、右隣ではなく左隣を選ぶ', () => {
    const { tabs } = setup()
    tabs.add() // slot-2
    tabs.add() // slot-3
    tabs.select('slot-2')
    tabs.remove('slot-2')
    expect(tabs.getSnapshot().selectedSlotId).toBe('slot-1')
  })

  it('先頭の選択中のタブを消すと右隣を選ぶ', () => {
    const { tabs } = setup()
    tabs.add() // slot-2
    tabs.select('slot-1')
    tabs.remove('slot-1')
    expect(tabs.getSnapshot().selectedSlotId).toBe('slot-2')
  })

  it('選択していないタブを消しても選択は変えない', () => {
    const { tabs } = setup()
    tabs.add() // slot-2(選択中)
    tabs.remove('slot-1')
    expect(tabs.getSnapshot().selectedSlotId).toBe('slot-2')
  })

  it('最後の 1 つは消さず false を返す', () => {
    const { tabs } = setup()
    const [only] = tabs.getSnapshot().tabs
    expect(tabs.remove('slot-1')).toBe(false)
    expect(only.controller.dispose).not.toHaveBeenCalled()
  })

  it('ensure は既存のタブを返し、無ければ上限の範囲で作る(選択は変えない)', () => {
    const { tabs } = setup(2)
    expect(tabs.ensure('slot-1')?.slotId).toBe('slot-1')
    expect(tabs.ensure('restored')?.slotId).toBe('restored')
    expect(tabs.getSnapshot().selectedSlotId).toBe('slot-1')
    expect(tabs.ensure('another')).toBeNull()
  })

  it('変化のたびに購読者へ知らせ、変化が無ければ同じ snapshot を返す', () => {
    const { tabs } = setup()
    const listener = vi.fn()
    const unsubscribe = tabs.subscribe(listener)
    const before = tabs.getSnapshot()
    expect(tabs.getSnapshot()).toBe(before)
    tabs.add()
    expect(listener).toHaveBeenCalledTimes(1)
    expect(tabs.getSnapshot()).not.toBe(before)
    tabs.select(tabs.getSnapshot().selectedSlotId) // 同じタブの選択は変化ではない
    expect(listener).toHaveBeenCalledTimes(1)
    unsubscribe()
    tabs.add()
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('存在しないタブの select・remove は何もしない', () => {
    const { tabs } = setup()
    const before = tabs.getSnapshot()
    tabs.select('missing')
    expect(tabs.remove('missing')).toBe(false)
    expect(tabs.getSnapshot()).toBe(before)
  })
})
