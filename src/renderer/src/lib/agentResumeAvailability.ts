import type { AgentHistoryInfo, PromptExecutionMode } from '@shared/types'
import type { AgentSessionStatus } from './agentSessionTabState'
import { findActiveAgentTabByClaudeSessionId } from './agentSessionTabState'
import { isSamePath } from './pathUtils'
import { RUN_DISABLED_LOADING_MODE } from './agentSendMessages'
import {
  AGENT_RESUME_ENTRY_LEGACY_MODE,
  AGENT_RESUME_LAST_LOADING,
  AGENT_RESUME_LAST_NO_RECORD,
  agentResumeEntryFolderMismatch,
  agentResumeEntryInUse,
  agentResumeLastInUse
} from './agentSessionMessages'

// claude のセッションの再開の入口(ターミナルのタブの「前回の続きから」・実行の履歴の「このセッションで再開」)の押せない理由
// (設計書「前回の続きから」「このセッションで再開 の押せない理由」)。React に依存しない純粋な関数で、組み立ては useAgentResume。
// 同じ ID のタブの判定は renderer の表示のためで、拒否の正は main(別のウィンドウのセッションは renderer から見えない)

/** 「前回」の取得の結果(useAgentLastSession) */
export type AgentLastSessionLookup =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'found'; claudeSessionId: string }

/** 押せない理由の判定に使うタブの値(AgentSessionTabView の一部) */
export interface AgentResumeTab {
  label: string
  status: AgentSessionStatus
  claudeSessionId: string | null
}

/**
 * 「前回の続きから」の押せない理由。起動の理由(フォルダ無し・方式の切り替えの途中)を優先し、その後に取得中・記録なし・
 * 同じ ID のタブが起動中か実行中。押せるなら null
 */
export function getResumeLastDisabledReason({
  startDisabledReason,
  lastSession,
  tabs
}: {
  startDisabledReason: string | null
  lastSession: AgentLastSessionLookup
  tabs: readonly AgentResumeTab[]
}): string | null {
  if (startDisabledReason !== null) return startDisabledReason
  if (lastSession.kind === 'loading') return AGENT_RESUME_LAST_LOADING
  if (lastSession.kind === 'none') return AGENT_RESUME_LAST_NO_RECORD
  const running = findActiveAgentTabByClaudeSessionId(tabs, lastSession.claudeSessionId)
  return running === undefined ? null : agentResumeLastInUse(running.label)
}

/**
 * 「このセッションで再開」の押せない理由(上から順に、最初に当たったものを 1 つ)。実行方式の読み込み中 → エージェント CLI 方式でない →
 * 記録したフォルダを開いていない(isSamePath。Windows は大文字小文字を区別しない) → 起動を受け付けない間 → 同じ ID のタブが
 * 起動中・実行中 → タブが上限(+ と同じ。L-048)。押せるなら null
 */
export function getResumeEntryDisabledReason({
  mode,
  folderPath,
  recorded,
  startDisabledReason,
  addDisabledReason,
  tabs
}: {
  mode: PromptExecutionMode | null
  folderPath: string | null
  recorded: AgentHistoryInfo
  startDisabledReason: string | null
  addDisabledReason: string | null
  tabs: readonly AgentResumeTab[]
}): string | null {
  if (mode === null) return RUN_DISABLED_LOADING_MODE
  // 方式を足したときにエージェント CLI 方式として押せるようにしないよう、エージェント CLI 方式でないものはすべて止める
  if (mode !== 'agent-cli') return AGENT_RESUME_ENTRY_LEGACY_MODE
  if (folderPath === null || !isSamePath(folderPath, recorded.folderPath)) {
    return agentResumeEntryFolderMismatch(recorded.folderPath)
  }
  if (startDisabledReason !== null) return startDisabledReason
  const running = findActiveAgentTabByClaudeSessionId(tabs, recorded.claudeSessionId)
  if (running !== undefined) return agentResumeEntryInUse(running.label)
  return addDisabledReason
}
