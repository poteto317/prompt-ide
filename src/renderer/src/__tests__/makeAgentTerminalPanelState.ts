import { vi } from 'vitest'
import type { AgentTerminalPanelState } from '../hooks/useAgentWorkspace'
import type { AgentTerminalPanelLayout } from '../hooks/useAgentTerminalPanel'
import type { AgentInterruptPanelState } from '../hooks/useAgentInterrupt'
import type { AgentPermissionAnswerPanelState } from '../hooks/useAgentPermissionAnswer'
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

/** 帯の 許可・拒否 の状態の型付きの偽物。既定は「出さない」(許可待ちでないとき) */
export function makeAgentPermissionAnswerPanelState(
  overrides: Partial<AgentPermissionAnswerPanelState> = {}
): AgentPermissionAnswerPanelState {
  return {
    visible: false,
    question: null,
    allow: { disabledReason: null, ariaLabel: '許可（claude 1 の許可の確認に Yes で答える）' },
    deny: { disabledReason: null, ariaLabel: '拒否（claude 1 の許可の確認に No で答える）' },
    notice: null,
    onAnswer: vi.fn(),
    ...overrides
  }
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
    permissionAnswer: makeAgentPermissionAnswerPanelState(),
    appCliKind: 'claude',
    ...overrides
  }
}
