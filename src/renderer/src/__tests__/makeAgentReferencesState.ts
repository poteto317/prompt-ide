import { vi } from 'vitest'
import type { AgentReferencesPanelState } from '../types'
import type { AgentReferencesState } from '../hooks/useAgentReferences'
import { EMPTY_PREPARED_AGENT_REFERENCES } from '../lib/agentReferenceCandidates'

// 参照の状態(useAgentReferences の戻り値とプロンプトパネルの参照の行)の型付きの偽物(1 か所から作る。パターン 102)。
// 既定の行は「開いているファイルは押せてオフ・選択は無い・足したファイルは無い」、既定の hook の戻り値は「行を出さない(従来の方式)」

export function makeAgentReferencesPanelState(
  overrides: Partial<AgentReferencesPanelState> = {}
): AgentReferencesPanelState {
  return {
    openFile: {
      label: '@src/app.ts',
      disabledReason: null,
      pressed: false,
      unsaved: false,
      onToggle: vi.fn()
    },
    selection: {
      label: null,
      disabledReason: 'エディタで範囲を選ぶと添えられます',
      pressed: false,
      unsaved: false,
      onToggle: vi.fn()
    },
    added: [],
    onRemove: vi.fn<AgentReferencesPanelState['onRemove']>(),
    onAddFromExplorer: vi.fn<AgentReferencesPanelState['onAddFromExplorer']>(),
    ...overrides
  }
}

export function makeAgentReferencesState(
  overrides: Partial<AgentReferencesState> = {}
): AgentReferencesState {
  return {
    panel: null,
    announcement: null,
    prepare: vi.fn<AgentReferencesState['prepare']>(() => EMPTY_PREPARED_AGENT_REFERENCES),
    markSent: vi.fn<AgentReferencesState['markSent']>(),
    ...overrides
  }
}
