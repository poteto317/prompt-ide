import type { AgentHistoryInfo } from '@shared/types'
import type { AgentSessionStatus } from './agentSessionTabState'

// タブの状態から claude の会話の情報を取り出す純粋な関数(セッションの再開の設計書「履歴への記録」)。
// 組み立ては useAgentWorkspace。React に依存しない

/** 送り先の控えに使うタブの値(AgentSessionTabView の一部) */
export interface AgentTabSessionSource {
  slotId: string
  label: string
  status: AgentSessionStatus
  claudeSessionId: string | null
}

/**
 * slotId のタブの今の claude の会話の ID・名前と開いているフォルダ(履歴の HistoryEntry.agent と同じ形)。タブが無い・
 * ID が無い(起動中の new・終了・起動の失敗)・フォルダを開いていなければ null
 */
export function describeAgentTabSession(
  tabs: readonly AgentTabSessionSource[],
  slotId: string,
  folderPath: string | null
): AgentHistoryInfo | null {
  const tab = tabs.find((t) => t.slotId === slotId)
  if (tab === undefined || tab.claudeSessionId === null || folderPath === null) return null
  return { claudeSessionId: tab.claudeSessionId, tabLabel: tab.label, folderPath }
}
