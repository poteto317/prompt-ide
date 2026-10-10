import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { AgentActivity } from '../../lib/agentActivity'
import type { AgentSessionTabView } from '../useAgentSessions'
import { useAgentStatusBar } from '../useAgentStatusBar'
import type { UseAgentStatusBarOptions } from '../useAgentStatusBar'
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

interface SetupResult {
  result: { readonly current: ReturnType<typeof useAgentStatusBar> }
  openPanel: ReturnType<typeof vi.fn<() => void>>
  activateTab: ReturnType<typeof vi.fn<(slotId: string) => void>>
}

const setup = (
  overrides: {
    enabled?: boolean
    activities?: [string, AgentActivity][]
    selectedSlotId?: string
  } = {}
): SetupResult => {
  const openPanel = vi.fn<() => void>()
  const activateTab = vi.fn<(slotId: string) => void>()
  const options: UseAgentStatusBarOptions = {
    enabled: overrides.enabled ?? true,
    tabs: makeTabs(),
    selectedSlotId: overrides.selectedSlotId ?? 'slot-1',
    activities: new Map(overrides.activities ?? DEFAULT_ACTIVITIES),
    openPanel,
    activateTab
  }
  const { result } = renderHook(() => useAgentStatusBar(options))
  return { result, openPanel, activateTab }
}

describe('useAgentStatusBar', () => {
  it('無効(エージェント CLI 方式でない)なら null', () => {
    expect(setup({ enabled: false }).result.current).toBeNull()
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

  it('押すと許可待ちのタブへ移る(パネルを開くのは activateTab)', () => {
    const { result, openPanel, activateTab } = setup()
    act(() => result.current!.onActivate())
    expect(activateTab).toHaveBeenCalledTimes(1)
    expect(activateTab).toHaveBeenCalledWith('slot-3')
    expect(openPanel).not.toHaveBeenCalled()
  })

  it('選択中のタブが、ほかのタブと同じ優先の活動なら、選択中のタブへ移る', () => {
    const { result, activateTab } = setup({
      selectedSlotId: 'slot-3',
      activities: [
        ['slot-1', 'idle'],
        ['slot-2', 'working'],
        ['slot-3', 'idle']
      ]
    })
    act(() => result.current!.onActivate())
    expect(activateTab).toHaveBeenCalledTimes(1)
    expect(activateTab).toHaveBeenCalledWith('slot-3')
  })

  it('当たるタブが無ければパネルを開くだけで、タブへは移らない', () => {
    const { result, openPanel, activateTab } = setup({
      activities: [
        ['slot-1', 'working'],
        ['slot-2', 'working']
      ]
    })
    act(() => result.current!.onActivate())
    expect(openPanel).toHaveBeenCalledTimes(1)
    expect(activateTab).not.toHaveBeenCalled()
  })
})
