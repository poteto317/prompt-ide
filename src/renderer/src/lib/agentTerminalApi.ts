import type {
  AgentLastSession,
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

export function getLastAgentSession(folderPath: string): Promise<AgentLastSession | null> {
  return window.api.getLastAgentSession(folderPath)
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

/** 作業中の知らせ(タブの活動が working に変わったとき)。main は hooks が効いているかの確かめに使う */
export function reportAgentSessionWorking(sessionId: string): void {
  window.api.reportAgentSessionWorking(sessionId)
}

/** 作業の終わりの知らせ(タブの活動が working の後に idle になったとき)。main は hooks が届かなくなったことの検知に使う */
export function reportAgentSessionWorkingEnded(sessionId: string): void {
  window.api.reportAgentSessionWorkingEnded(sessionId)
}
