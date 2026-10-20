import type { AgentSessionSnapshotEntry } from '@shared/types'
import type { AgentRegistrySnapshotEntry } from './agentSessionRegistry'
import type { AgentSessionInfo } from './agentSessionStarter'

// registry の snapshot(pty の sessionId だけ)に、starter が持つ CLI の種類と claude の会話の ID を足して、IPC で返す形にする
// (agentTerminal:getState の作り直しの後の合わせ込み)。Electron に依存しない

/**
 * 情報が引けないセッションは一覧から外してログに残す(exited の途中の瞬間〈starter の Map から消えた後、registry が枠から外す前〉
 * に当たりうる。合わせ込みの全体を止めない)
 */
export function attachSessionInfo(
  entries: readonly AgentRegistrySnapshotEntry[],
  sessionInfoOf: (sessionId: string) => AgentSessionInfo | undefined
): AgentSessionSnapshotEntry[] {
  return entries.flatMap((entry): AgentSessionSnapshotEntry[] => {
    const info = sessionInfoOf(entry.sessionId)
    if (info === undefined) {
      console.warn(
        '[agentTerminal:getState] セッションの種類と会話の ID が見つからないセッションを一覧から外します:',
        entry.sessionId
      )
      return []
    }
    return [{ slotId: entry.slotId, sessionId: entry.sessionId, ...info }]
  })
}
