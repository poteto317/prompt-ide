import type { AgentSessionSnapshotEntry } from '@shared/types'
import type { AgentRegistrySnapshotEntry } from './agentSessionRegistry'

// registry の snapshot(pty の sessionId だけ)に、starter が持つ claude の会話の ID を足して、IPC で返す形にする
// (agentTerminal:getState の作り直しの後の合わせ込み)。Electron に依存しない

/**
 * claude の会話の ID が引けないセッションは一覧から外してログに残す(exited の途中の瞬間〈starter の Map から消えた後、
 * registry が枠から外す前〉に当たりうる。合わせ込みの全体を止めない)
 */
export function attachClaudeSessionIds(
  entries: readonly AgentRegistrySnapshotEntry[],
  claudeSessionIdOf: (sessionId: string) => string | undefined
): AgentSessionSnapshotEntry[] {
  return entries.flatMap((entry): AgentSessionSnapshotEntry[] => {
    const claudeSessionId = claudeSessionIdOf(entry.sessionId)
    if (claudeSessionId === undefined) {
      console.warn(
        '[agentTerminal:getState] claude のセッション ID が見つからないセッションを一覧から外します:',
        entry.sessionId
      )
      return []
    }
    return [{ slotId: entry.slotId, sessionId: entry.sessionId, claudeSessionId }]
  })
}
