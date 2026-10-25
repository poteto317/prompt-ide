import type { AgentCliKind } from '@shared/agentCliKinds'
import type {
  AgentInterruptFollowUpResult,
  AgentInterruptResult,
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

/** 中断の 1 回目(作業を止める。ターミナルで Esc を押すのと同じ)。2 回目の要る種類は結果の followUp で案内される。書くバイト列は main が決める */
export function interruptAgentSession(sessionId: string): Promise<AgentInterruptResult> {
  return window.api.interruptAgentSession(sessionId)
}

/** 中断の 2 回目(copilot。renderer が画面を確かめ直してから頼む)。書くバイト列・回数・時間は main が決める */
export function interruptAgentSessionFollowUp(
  sessionId: string
): Promise<AgentInterruptFollowUpResult> {
  return window.api.interruptAgentSessionFollowUp(sessionId)
}

export function getAgentSessions(): Promise<AgentSessionSnapshotEntry[]> {
  return window.api.getAgentSessions()
}

/** このフォルダで最後に起動が確定した、cliKind の種類のセッション(前回の続きから)。照合は main が行う */
export function getLastAgentSession(
  folderPath: string,
  cliKind: AgentCliKind
): Promise<AgentLastSession | null> {
  return window.api.getLastAgentSession(folderPath, cliKind)
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
