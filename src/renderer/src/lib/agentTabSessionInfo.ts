import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentHistoryInfo } from '@shared/types'
import type { AgentSessionStatus } from './agentSessionTabState'

// タブの状態からエージェント CLI の会話の情報を取り出す純粋な関数(セッションの再開の設計書「履歴への記録」、段階 3a の設計書
// 「履歴への CLI の種類」)。組み立ては useAgentWorkspace。React に依存しない

/** 送り先の控えに使うタブの値(AgentSessionTabView の一部) */
export interface AgentTabSessionSource {
  slotId: string
  label: string
  status: AgentSessionStatus
  /** タブの種類(起動の結果の種類。無ければ設定の種類。AgentSessionTabView.cliKind) */
  cliKind: AgentCliKind
  claudeSessionId: string | null
}

/**
 * slotId のタブの今の会話の ID・種類・名前と開いているフォルダ(履歴の HistoryEntry.agent と同じ形)。タブが無い・
 * ID が無い(起動中の new・終了・起動の失敗)・フォルダを開いていなければ null
 */
export function describeAgentTabSession(
  tabs: readonly AgentTabSessionSource[],
  slotId: string,
  folderPath: string | null
): AgentHistoryInfo | null {
  const tab = tabs.find((t) => t.slotId === slotId)
  if (tab === undefined || tab.claudeSessionId === null || folderPath === null) return null
  return {
    claudeSessionId: tab.claudeSessionId,
    cliKind: tab.cliKind,
    tabLabel: tab.label,
    folderPath
  }
}
