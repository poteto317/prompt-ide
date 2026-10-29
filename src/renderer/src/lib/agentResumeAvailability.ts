import { AGENT_CLI_PROFILES, agentCliCapabilities } from '@shared/agentCliKinds'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentHistoryInfo, PromptExecutionMode } from '@shared/types'
import { knownAgentCliKindOf } from '@shared/historyAgentCliKind'
import type { AgentSessionStatus } from './agentSessionTabState'
import { findActiveAgentTabByCliSessionId } from './agentSessionTabState'
import { isSamePath } from './pathUtils'
import { RUN_DISABLED_LOADING_MODE } from './agentSendMessages'
import {
  AGENT_RESUME_ENTRY_LEGACY_MODE,
  AGENT_RESUME_LAST_LOADING,
  AGENT_RESUME_LAST_NO_RECORD,
  agentResumeEntryCliMismatch,
  agentResumeEntryFolderMismatch,
  agentResumeEntryInUse,
  agentResumeEntryUnknownCli,
  agentResumeEntryUnsupportedReason,
  agentResumeLastInUse,
  agentResumeLastUnsupportedReason
} from './agentSessionMessages'

// エージェント CLI のセッションの再開の入口(ターミナルのタブの「前回の続きから」・実行の履歴の「このセッションで再開」)の押せない理由
// (設計書「前回の続きから」「このセッションで再開 の押せない理由」)。React に依存しない純粋な関数で、組み立ては useAgentResume。
// 同じ ID のタブの判定は renderer の表示のためで、拒否の正は main(別のウィンドウのセッションは renderer から見えない)。
// 再開できるのは設定と同じ種類のセッションだけ(段階 3a の設計書「決めたこと(推奨案)」)。

/** 「前回」の取得の結果(useAgentLastSession)。found の cliKind は取りに行った種類 */
export type AgentLastSessionLookup =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'found'; cliKind: AgentCliKind; cliSessionId: string }

/** 押せない理由の判定に使うタブの値(AgentSessionTabView の一部) */
export interface AgentResumeTab {
  label: string
  status: AgentSessionStatus
  cliSessionId: string | null
}

/**
 * 「前回の続きから」の押せない理由。起動の理由(フォルダ無し・方式の切り替えの途中)を優先し、次に設定の CLI が再開に対応していないこと、その後に取得中・記録なし・
 * 同じ ID のタブが起動中か実行中。押せるなら null
 */
export function getResumeLastDisabledReason({
  startDisabledReason,
  appCliKind,
  lastSession,
  tabs
}: {
  startDisabledReason: string | null
  /** 設定の種類(次に起動する CLI) */
  appCliKind: AgentCliKind
  lastSession: AgentLastSessionLookup
  tabs: readonly AgentResumeTab[]
}): string | null {
  if (startDisabledReason !== null) return startDisabledReason
  // 次に起動する CLI(設定の種類)が再開に対応していない。起動の理由の直後(設計書「入口ごとの表」)。main も resume-unsupported で断る
  if (!agentCliCapabilities(appCliKind).sessionResume) {
    return agentResumeLastUnsupportedReason(AGENT_CLI_PROFILES[appCliKind].commandName)
  }
  if (lastSession.kind === 'loading') return AGENT_RESUME_LAST_LOADING
  if (lastSession.kind === 'none') return AGENT_RESUME_LAST_NO_RECORD
  const running = findActiveAgentTabByCliSessionId(tabs, lastSession.cliSessionId)
  return running === undefined ? null : agentResumeLastInUse(running.label)
}

/**
 * 「このセッションで再開」の押せない理由(上から順に、最初に当たったものを 1 つ)。実行方式の読み込み中 → エージェント CLI 方式でない →
 * 設定の CLI が再開に対応していない → エントリの種類をこの版が知らない → エントリの種類と設定の種類が違う → 記録したフォルダを
 * 開いていない(isSamePath。Windows は大文字小文字を区別しない) → 起動を受け付けない間 → 同じ ID のタブが起動中・実行中 →
 * タブが上限(+ と同じ。L-048)。種類の理由をフォルダの理由より前に置くのは、フォルダを開き直しても押せないため。押せるなら null
 */
export function getResumeEntryDisabledReason({
  mode,
  appCliKind,
  folderPath,
  recorded,
  startDisabledReason,
  addDisabledReason,
  tabs
}: {
  mode: PromptExecutionMode | null
  /** 設定の種類(次に起動する CLI。タブの種類ではない) */
  appCliKind: AgentCliKind
  folderPath: string | null
  recorded: AgentHistoryInfo
  startDisabledReason: string | null
  addDisabledReason: string | null
  tabs: readonly AgentResumeTab[]
}): string | null {
  if (mode === null) return RUN_DISABLED_LOADING_MODE
  // 方式を足したときにエージェント CLI 方式として押せるようにしないよう、エージェント CLI 方式でないものはすべて止める
  if (mode !== 'agent-cli') return AGENT_RESUME_ENTRY_LEGACY_MODE
  // 設定の CLI が再開に対応していない。実行方式の判定の直後(設計書「入口ごとの表」)
  if (!agentCliCapabilities(appCliKind).sessionResume) {
    return agentResumeEntryUnsupportedReason(AGENT_CLI_PROFILES[appCliKind].commandName)
  }
  // エントリの種類(この版が知らない種類・設定と違う種類)。再開は設定と同じ種類だけ(起動の種類は main が読む設定で決まるため)
  const entryCliKind = knownAgentCliKindOf(recorded)
  if (entryCliKind === null) return agentResumeEntryUnknownCli(recorded.cliKind)
  if (entryCliKind !== appCliKind) {
    return agentResumeEntryCliMismatch(
      AGENT_CLI_PROFILES[entryCliKind].commandName,
      AGENT_CLI_PROFILES[appCliKind].commandName
    )
  }
  if (folderPath === null || !isSamePath(folderPath, recorded.folderPath)) {
    return agentResumeEntryFolderMismatch(recorded.folderPath)
  }
  if (startDisabledReason !== null) return startDisabledReason
  const running = findActiveAgentTabByCliSessionId(tabs, recorded.claudeSessionId)
  if (running !== undefined) return agentResumeEntryInUse(running.label)
  return addDisabledReason
}
