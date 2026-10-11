import { describe, it, expect, vi } from 'vitest'
import {
  makeAgentTerminalPanelLayout,
  makeAgentTerminalPanelState
} from '../makeAgentTerminalPanelState'
import { makeAgentSessionsState } from '../makeAgentSessionsState'

describe('makeAgentTerminalPanelLayout', () => {
  it('既定は開いていて最大化していない', () => {
    const layout = makeAgentTerminalPanelLayout()
    expect(layout.isOpen).toBe(true)
    expect(layout.isMaximized).toBe(false)
    expect(vi.isMockFunction(layout.open)).toBe(true)
    expect(vi.isMockFunction(layout.toggleOpen)).toBe(true)
    expect(vi.isMockFunction(layout.toggleMaximized)).toBe(true)
  })

  it('指定した項目だけを上書きする', () => {
    const layout = makeAgentTerminalPanelLayout({ isMaximized: true })
    expect(layout.isOpen).toBe(true)
    expect(layout.isMaximized).toBe(true)
  })
})

describe('makeAgentTerminalPanelState', () => {
  it('既定はどのタブも未起動・送信中でない・活動なし・前回の続きからを押せる', () => {
    const state = makeAgentTerminalPanelState()
    expect(state.sessions.selected.status).toBe('none')
    expect(state.layout.isOpen).toBe(true)
    expect(state.sendingSlotId).toBeNull()
    expect(state.activities.size).toBe(0)
    expect(state.resumeLast.disabledReason).toBeNull()
    expect(vi.isMockFunction(state.resumeLast.onResume)).toBe(true)
  })

  it('指定した項目だけを上書きし、呼ぶたびに別の偽物を作る', () => {
    const sessions = makeAgentSessionsState()
    const state = makeAgentTerminalPanelState({ sessions, sendingSlotId: 'a' })
    expect(state.sessions).toBe(sessions)
    expect(state.sendingSlotId).toBe('a')
    expect(state.resumeLast.disabledReason).toBeNull()
    expect(makeAgentTerminalPanelState().resumeLast.onResume).not.toBe(state.resumeLast.onResume)
  })
})
