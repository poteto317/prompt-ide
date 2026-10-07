import type {
  AgentChangesListResult,
  AgentChangesState,
  AgentRevertAllEntry,
  DiscardAllResult
} from '@shared/types'

// エージェントの変更の IPC の窓口(window.api)。renderer の部品は window.api を直接触らずここを使う

export function beginAgentChanges(): Promise<AgentChangesState> {
  return window.api.beginAgentChanges()
}

export function getAgentChangesState(): Promise<AgentChangesState> {
  return window.api.getAgentChangesState()
}

export function listAgentChanges(): Promise<AgentChangesListResult> {
  return window.api.listAgentChanges()
}

export function getAgentChangeDiff(path: string): Promise<string> {
  return window.api.getAgentChangeDiff(path)
}

export function revertAgentChange(path: string): Promise<void> {
  return window.api.revertAgentChange(path)
}

export function revertAgentChangeHunk(path: string, patch: string): Promise<void> {
  return window.api.revertAgentChangeHunk(path, patch)
}

export function revertAllAgentChanges(expected: AgentRevertAllEntry[]): Promise<DiscardAllResult> {
  return window.api.revertAllAgentChanges(expected)
}

export function clearAgentChanges(): Promise<void> {
  return window.api.clearAgentChanges()
}
