import { useState } from 'react'
import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { AgentSessionTabView } from '../useAgentSessions'
import { useAgentTabActivation } from '../useAgentTabActivation'
import { makeAgentSessionTabView } from '../../__tests__/makeAgentSessionsState'

interface Setup {
  tabs: AgentSessionTabView[]
  openPanel: ReturnType<typeof vi.fn<() => void>>
  selectTab: ReturnType<typeof vi.fn<(slotId: string) => void>>
  result: { readonly current: (slotId: string) => void }
  /** 利用者がほかの操作でタブを選び直した(次の描画から反映) */
  reselect: (slotId: string) => void
  /** 最後の描画で選択中だったタブの slotId */
  renderedSelectedSlotId: () => string
  rerender: () => void
}

// 選択中のタブは本物(useAgentSessions)と同じく state に持ち、selectTab は次の描画から反映する
const setup = (): Setup => {
  const tabs = [1, 2, 3].map((n) =>
    makeAgentSessionTabView({ slotId: `slot-${n}`, label: `claude ${n}`, status: 'running' })
  )
  const openPanel = vi.fn<() => void>()
  let setSelectedSlotId: (slotId: string) => void = () => undefined
  const selectTab = vi.fn((slotId: string) => setSelectedSlotId(slotId))
  let renderedSelectedSlotId = ''
  const { result, rerender } = renderHook(() => {
    const [selectedSlotId, setSelected] = useState('slot-1')
    setSelectedSlotId = setSelected
    renderedSelectedSlotId = selectedSlotId
    return useAgentTabActivation({
      selected: tabs.find((tab) => tab.slotId === selectedSlotId)!,
      selectTab,
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

describe('useAgentTabActivation', () => {
  it('パネルを開き、指定したタブを選び、選択が描画された後にそのタブのターミナルへフォーカスを移す', () => {
    const { tabs, openPanel, selectTab, result, renderedSelectedSlotId } = setup()
    const selectedAtFocus: string[] = []
    vi.mocked(tabs[2].controller.focus).mockImplementation(() => {
      selectedAtFocus.push(renderedSelectedSlotId())
    })
    act(() => result.current('slot-3'))
    expect(selectedAtFocus).toEqual(['slot-3'])
    expect(openPanel).toHaveBeenCalledTimes(1)
    expect(selectTab).toHaveBeenCalledWith('slot-3')
    expect(tabs[0].controller.focus).not.toHaveBeenCalled()
  })

  it('指定したタブが既に選択中でも(選択の描画が起きなくても)、呼んだ後の描画でフォーカスを移す', () => {
    const { tabs, result } = setup()
    act(() => result.current('slot-1'))
    expect(tabs[0].controller.focus).toHaveBeenCalledTimes(1)
  })

  it('フォーカスは 1 回だけで、後の描画で繰り返さない', () => {
    const { tabs, result, rerender } = setup()
    act(() => result.current('slot-3'))
    act(() => rerender())
    act(() => rerender())
    expect(tabs[2].controller.focus).toHaveBeenCalledTimes(1)
  })

  it('描画までに選択が別のタブへ移っていたら、フォーカスを移さない', () => {
    const { tabs, result, reselect } = setup()
    act(() => {
      result.current('slot-3')
      reselect('slot-2')
    })
    for (const tab of tabs) expect(tab.controller.focus).not.toHaveBeenCalled()
  })

  it('openPanel・selectTab が変わらなければ同じ参照を返す', () => {
    const { result, rerender } = setup()
    const first = result.current
    act(() => rerender())
    expect(result.current).toBe(first)
  })
})
