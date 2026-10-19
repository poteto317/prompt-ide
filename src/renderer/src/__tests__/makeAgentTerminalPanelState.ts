import { vi } from 'vitest'
import type { AgentTerminalPanelState } from '../hooks/useAgentWorkspace'
import type { AgentTerminalPanelLayout } from '../hooks/useAgentTerminalPanel'
import type { AgentInterruptPanelState } from '../hooks/useAgentInterrupt'
import { makeAgentSessionsState } from './makeAgentSessionsState'

// ターミナルのパネルの開閉・最大化の状態の型付きの偽物。既定は「開いていて最大化していない」
export function makeAgentTerminalPanelLayout(
  overrides: Partial<AgentTerminalPanelLayout> = {}
): AgentTerminalPanelLayout {
  return {
    isOpen: true,
    isMaximized: false,
    open: vi.fn(),
    toggleOpen: vi.fn(),
    toggleMaximized: vi.fn(),
    ...overrides
  }
}

/** 帯の 中断 の状態の型付きの偽物。既定は「出さない」(どのタブも未起動のとき) */
export function makeAgentInterruptPanelState(
  overrides: Partial<AgentInterruptPanelState> = {}
): AgentInterruptPanelState {
  return { visible: false, disabledReason: null, notice: null, onInterrupt: vi.fn(), ...overrides }
}

// useAgentWorkspace の agentTerminal(AgentTerminalPanelState)の型付きの偽物(1 か所から作る。パターン 102)。フィールドを足したときに
// パネル・エディタのパネル・useAppState のテストを 1 か所の変更で追従させる。既定は「どのタブも未起動・送信中でない・前回の続きから
// を押せる」状態
export function makeAgentTerminalPanelState(
  overrides: Partial<AgentTerminalPanelState> = {}
): AgentTerminalPanelState {
  return {
    sessions: makeAgentSessionsState(),
    layout: makeAgentTerminalPanelLayout(),
    sendingSlotId: null,
    activities: new Map(),
    resumeLast: { disabledReason: null, onResume: vi.fn() },
    interrupt: makeAgentInterruptPanelState(),
    ...overrides
  }
}
