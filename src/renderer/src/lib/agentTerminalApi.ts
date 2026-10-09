import type {
  AgentSessionData,
  AgentSessionExit,
  AgentSessionSnapshotEntry,
  AgentStartRequest,
  AgentStartResult
} from '@shared/types'

// エージェントのセッションの IPC の窓口(window.api)。renderer の部品は window.api を直接触らずここを使う

export function startAgentSession(request: AgentStartRequest): Promise<AgentStartResult> {
  return window.api.startAgentSession(request)
}

export function writeAgentSession(sessionId: string, data: string): void {
  window.api.writeAgentSession(sessionId, data)
}

export function resizeAgentSession(sessionId: string, cols: number, rows: number): void {
  window.api.resizeAgentSession(sessionId, cols, rows)
}

export function stopAgentSession(sessionId: string): Promise<void> {
  return window.api.stopAgentSession(sessionId)
}

export function getAgentSessions(): Promise<AgentSessionSnapshotEntry[]> {
  return window.api.getAgentSessions()
}

export function onAgentData(listener: (payload: AgentSessionData) => void): () => void {
  return window.api.onAgentData(listener)
}

export function onAgentExit(listener: (payload: AgentSessionExit) => void): () => void {
  return window.api.onAgentExit(listener)
}

export function setAgentTerminalFocused(focused: boolean): void {
  window.api.setAgentTerminalFocused(focused)
}
