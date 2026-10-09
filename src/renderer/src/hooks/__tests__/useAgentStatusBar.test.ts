import { useState } from 'react'
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentSessionTabView } from '../useAgentSessions'
import { useAgentStatusBar } from '../useAgentStatusBar'
import type { AgentStatusBarState } from '../useAgentStatusBar'
import { makeAgentSessionTabView } from '../../__tests__/makeAgentSessionsState'

// タブ 1・2・3 はすべて running。既定の活動はタブ 1 が作業中・タブ 2 が入力待ち・タブ 3 が許可待ち
const makeTabs = (): AgentSessionTabView[] =>
  [1, 2, 3].map((n) =>
    makeAgentSessionTabView({ slotId: `slot-${n}`, label: `claude ${n}`, status: 'running' })
  )

const DEFAULT_ACTIVITIES: [string, AgentActivity][] = [
  ['slot-1', 'working'],
  ['slot-2', 'idle'],
  ['slot-3', 'permission']
]

interface Setup {
  tabs: AgentSessionTabView[]
  openPanel: ReturnType<typeof vi.fn<() => void>>
  selectTab: ReturnType<typeof vi.fn<(slotId: string) => void>>
  result: { readonly current: AgentStatusBarState | null }
  /** 利用者がほかの操作でタブを選び直した(次の描画から反映) */
  reselect: (slotId: string) => void
  /** 最後の描画で選択中だったタブの slotId */
  renderedSelectedSlotId: () => string
  rerender: () => void
}

// 選択中のタブは本物(useAgentSessions)と同じく state に持ち、selectTab は次の描画から反映する
const setup = (
  overrides: { enabled?: boolean; activities?: [string, AgentActivity][] } = {}
): Setup => {
  const tabs = makeTabs()
  const activities = new Map(overrides.activities ?? DEFAULT_ACTIVITIES)
  const openPanel = vi.fn<() => void>()
  let setSelectedSlotId: (slotId: string) => void = () => undefined
  const selectTab = vi.fn((slotId: string) => setSelectedSlotId(slotId))
  let renderedSelectedSlotId = ''
  const { result, rerender } = renderHook(() => {
    const [selectedSlotId, setSelected] = useState('slot-1')
    setSelectedSlotId = setSelected
    renderedSelectedSlotId = selectedSlotId
    return useAgentStatusBar({
      enabled: overrides.enabled ?? true,
      tabs,
      selected: tabs.find((tab) => tab.slotId === selectedSlotId)!,
      selectTab,
      activities,
      openPanel
    })
  })
  return {
    tabs,
    openPanel,
    selectTab,
    result,
    reselect: (slotId) => setSelectedSlotId(slotId),
    renderedSelectedSlotId: () => renderedSelectedSlotId,
    rerender: () => rerender()
  }
}

describe('useAgentStatusBar', () => {
  it('無効(エージェント CLI 方式でない)なら null', () => {
    const { result } = setup({ enabled: false })
    expect(result.current).toBeNull()
  })

  it('running のタブの活動のまとめと強調の要否を返す', () => {
    const { result } = setup()
    expect(result.current!.items).toEqual([
      { activity: 'permission', count: 1 },
      { activity: 'working', count: 1 },
      { activity: 'idle', count: 1 }
    ])
    expect(result.current!.needsAttention).toBe(true)
  })

  it('操作が必要な活動が無ければ強調しない', () => {
    const { result } = setup({
      activities: [
        ['slot-1', 'working'],
        ['slot-2', 'idle']
      ]
    })
    expect(result.current!.needsAttention).toBe(false)
  })

  it('押すとパネルを開き、許可待ちのタブを選び、選択が描画された後にそのタブのターミナルへフォーカスを移す', () => {
    const { tabs, openPanel, selectTab, result, renderedSelectedSlotId } = setup()
    // フォーカスの時点で、選択(state)が許可待ちのタブへ移った描画が終わっていること
    const selectedAtFocus: string[] = []
    vi.mocked(tabs[2].controller.focus).mockImplementation(() => {
      selectedAtFocus.push(renderedSelectedSlotId())
    })
    act(() => result.current!.onActivate())
    expect(selectedAtFocus).toEqual(['slot-3'])
    expect(openPanel).toHaveBeenCalledTimes(1)
    expect(selectTab).toHaveBeenCalledWith('slot-3')
    expect(tabs[2].controller.focus).toHaveBeenCalledTimes(1)
    expect(tabs[0].controller.focus).not.toHaveBeenCalled()
  })

  it('選んだタブが既に選択中でも(選択の描画が起きなくても)、押した後の描画でフォーカスを移す', () => {
    const { tabs, result } = setup({
      activities: [
        ['slot-1', 'permission'],
        ['slot-2', 'idle']
      ]
    })
    act(() => result.current!.onActivate())
    expect(tabs[0].controller.focus).toHaveBeenCalledTimes(1)
  })

  it('選択中のタブが、ほかのタブと同じ優先の活動なら、選択中のタブのままフォーカスを移す', () => {
    const { tabs, selectTab, result, reselect } = setup({
      activities: [
        ['slot-1', 'idle'],
        ['slot-2', 'working'],
        ['slot-3', 'idle']
      ]
    })
    act(() => reselect('slot-3'))
    act(() => result.current!.onActivate())
    expect(selectTab).toHaveBeenCalledWith('slot-3')
    expect(tabs[2].controller.focus).toHaveBeenCalledTimes(1)
    expect(tabs[0].controller.focus).not.toHaveBeenCalled()
  })

  it('当たるタブが無ければパネルを開くだけで、選択もフォーカスもしない', () => {
    const { tabs, openPanel, selectTab, result, rerender } = setup({
      activities: [
        ['slot-1', 'working'],
        ['slot-2', 'working']
      ]
    })
    act(() => result.current!.onActivate())
    act(() => rerender())
    expect(openPanel).toHaveBeenCalledTimes(1)
    expect(selectTab).not.toHaveBeenCalled()
    for (const tab of tabs) expect(tab.controller.focus).not.toHaveBeenCalled()
  })

  it('フォーカスは 1 回だけで、後の描画で繰り返さない', () => {
    const { tabs, result, rerender } = setup()
    act(() => result.current!.onActivate())
    act(() => rerender())
    act(() => rerender())
    expect(tabs[2].controller.focus).toHaveBeenCalledTimes(1)
  })

  it('描画までに選択が別のタブへ移っていたら、フォーカスを移さない', () => {
    const { tabs, result, reselect } = setup()
    // 押した直後、描画の前に別のタブ(タブ 2)が選び直される
    act(() => {
      result.current!.onActivate()
      reselect('slot-2')
    })
    for (const tab of tabs) expect(tab.controller.focus).not.toHaveBeenCalled()
  })
})
