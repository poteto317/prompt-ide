import { useCallback } from 'react'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentHistoryInfo, AgentLaunchRequest, PromptExecutionMode } from '@shared/types'
import type { HistoryActionAvailability, HistoryEntry } from '../types'
import type { AgentSessionsState } from './useAgentSessions'
import { knownAgentCliKindOf } from '@shared/historyAgentCliKind'
import { useAgentLastSession } from './useAgentLastSession'
import { useLatestRef } from './useLatestRef'
import {
  getResumeEntryDisabledReason,
  getResumeLastDisabledReason
} from '../lib/agentResumeAvailability'

// エージェント CLI のセッションの再開の入口(ターミナルのタブの「前回の続きから」・実行の履歴の「このセッションで再開」)の押せない理由と
// 操作の組み立て(セッションの再開の設計書「前回の続きから」「このセッションで再開」)。押せない理由の規則は
// lib/agentResumeAvailability.ts。useAgentWorkspace から使う

/** ターミナルのタブの「前回の続きから」(useAgentResume が組み立て、useAgentWorkspace 経由で AgentTerminalPanel へ渡す) */
export interface AgentResumeLastState {
  /** 押せない理由(起動の理由を優先)。押せるなら null */
  disabledReason: string | null
  /** 押した時点の理由を求め直し、押せるときだけ slotId のタブで前回の ID を再開する(L-058) */
  onResume: (slotId: string) => void
}

export interface UseAgentResumeOptions {
  folderPath: string | null
  /** 実行方式(読み込み中は null) */
  mode: PromptExecutionMode | null
  /** 設定の種類(次に起動する CLI)。再開の入口の判定に使う(タブの種類ではない) */
  appCliKind: AgentCliKind
  sessions: Pick<
    AgentSessionsState,
    | 'tabs'
    | 'startDisabledReason'
    | 'addDisabledReason'
    | 'start'
    | 'resumeInNewTab'
    | 'startConfirmedCount'
  >
  /** 足したタブへ移る(パネルを開く・選ぶ・フォーカス) */
  activateTab: (slotId: string) => void
}

export interface AgentResumeState {
  resumeLast: AgentResumeLastState
  /** 履歴のエントリの このセッションで再開 の押せる条件。従来のエントリ(agent が null)は null(ボタンを出さない) */
  resumeActionOf: (entry: HistoryEntry) => HistoryActionAvailability | null
  /** 履歴の このセッションで再開。押した時点の理由を求め直し、押せるときだけ新しいタブで再開して、そのタブへ移る(L-048・L-058) */
  onResumeEntry: (entry: HistoryEntry) => void
}

export function useAgentResume({
  folderPath,
  mode,
  appCliKind,
  sessions,
  activateTab
}: UseAgentResumeOptions): AgentResumeState {
  // 「前回」(このフォルダで最後に起動が確定したセッション)。main の記録が変わるのは起動の確定(started)のときだけなので、
  // 起動の確定の回数だけを取り直しの契機にする(終了・タブを閉じる・作り直しでは記録は変わらず、取り直しても結果は同じ)。
  // 「同じ ID が動いている」理由は取り直しではなく、描画ごとのタブの状態から求める(getResumeLastDisabledReason)
  const lastSession = useAgentLastSession({
    folderPath,
    cliKind: appCliKind,
    enabled: mode === 'agent-cli',
    refreshKey: String(sessions.startConfirmedCount)
  })
  const resumeLastReason = getResumeLastDisabledReason({
    startDisabledReason: sessions.startDisabledReason,
    appCliKind,
    lastSession,
    tabs: sessions.tabs
  })
  // 押した時点の理由と「前回」で判断する(描画をまたいで同じ参照の関数にするため ref から読む)
  const resumeLastRef = useLatestRef({ reason: resumeLastReason, lastSession })
  const startAgentSession = sessions.start
  const resumeLast = useCallback(
    (slotId: string): void => {
      const { reason, lastSession: current } = resumeLastRef.current
      if (reason !== null || current.kind !== 'found') return
      const launch: AgentLaunchRequest = {
        kind: 'resume',
        cliSessionId: current.cliSessionId,
        cliKind: current.cliKind
      }
      void startAgentSession(slotId, launch)
    },
    [resumeLastRef, startAgentSession]
  )
  // 履歴のエントリの このセッションで再開 の押せない理由(タブ・フォルダ・方式・起動の理由から求める)
  const resumeEntryReasonOf = (recorded: AgentHistoryInfo): string | null =>
    getResumeEntryDisabledReason({
      mode,
      appCliKind,
      folderPath,
      recorded,
      startDisabledReason: sessions.startDisabledReason,
      addDisabledReason: sessions.addDisabledReason,
      tabs: sessions.tabs
    })
  const resumeActionOf = (entry: HistoryEntry): HistoryActionAvailability | null => {
    if (entry.agent === null) return null
    const reason = resumeEntryReasonOf(entry.agent)
    return { disabled: reason !== null, reason }
  }
  const onResumeEntry = (entry: HistoryEntry): void => {
    if (entry.agent === null) return
    // 押した時点の条件で求め直し、押せないときは何もしない(ボタンは押せないが、処理の側でも同じ条件で守る。L-058)
    if (resumeEntryReasonOf(entry.agent) !== null) return
    // 送り先の種類をこの版の種類として読む。知らない種類(新しい版の種類)・設定と違う種類は、上の押せない理由
    // (agentResumeAvailability.ts)で止まっている。ここでは種類を型として絞るために読み直し、知らない種類は何もしない。
    // 設定と同じ種類をそのまま渡し、押した後に別のウィンドウで設定が変わっていれば main が resume-cli-mismatch で断る
    const entryCliKind = knownAgentCliKindOf(entry.agent)
    if (entryCliKind === null) return
    const slotId = sessions.resumeInNewTab(entry.agent.claudeSessionId, entryCliKind)
    // タブを足せなかった(押してから条件が変わった)ら何もしない。起動の失敗は足したタブのエラーとして出る
    if (slotId !== null) activateTab(slotId)
  }
  return {
    resumeLast: { disabledReason: resumeLastReason, onResume: resumeLast },
    resumeActionOf,
    onResumeEntry
  }
}
