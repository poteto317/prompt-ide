import { vi } from 'vitest'
import type { AgentWorkspaceState } from '../hooks/useAgentWorkspace'
import { makeAgentSessionsState } from './makeAgentSessionsState'

// useAgentWorkspace の戻り値の型付きの偽物(1 か所から作る。パターン 102)。useAppState のテストは useAgentWorkspace の内側
// (useExecutionMode・useAgentSessions・xterm の controller)ではなく、これを差し替えて組み立てだけを確かめる。
// 既定は「従来の方式・どのタブも未起動・押せる」状態で、confirmStopAgent は確認せずに true を返す
export function makeAgentWorkspaceState(
  overrides: Partial<AgentWorkspaceState> = {}
): AgentWorkspaceState {
  return {
    executionModePanel: {
      mode: 'legacy',
      saveError: null,
      isLocked: false,
      lockedReason: null,
      onSelect: vi.fn<AgentWorkspaceState['executionModePanel']['onSelect']>()
    },
    agentNotificationPanel: {
      enabled: true,
      saveError: null,
      onChange: vi.fn<AgentWorkspaceState['agentNotificationPanel']['onChange']>()
    },
    confirmStopAgent: vi.fn<AgentWorkspaceState['confirmStopAgent']>(() => true),
    promptRun: {
      isRunDisabled: false,
      runDisabledReason: null,
      agentSend: null,
      showToolSelector: true,
      runAriaLabel: 'プロンプトを実行',
      isRerunDisabled: false,
      rerunDisabledReason: null
    },
    bottomPanel: 'output',
    agentTerminal: {
      sessions: makeAgentSessionsState(),
      sendingSlotId: null,
      activities: new Map(),
      layout: {
        isOpen: true,
        isMaximized: false,
        open: vi.fn(),
        toggleOpen: vi.fn(),
        toggleMaximized: vi.fn()
      }
    },
    statusBarAgent: null,
    agentAnnouncement: '',
    sendToAgent: vi.fn<AgentWorkspaceState['sendToAgent']>(async () => undefined),
    ...overrides
  }
}
