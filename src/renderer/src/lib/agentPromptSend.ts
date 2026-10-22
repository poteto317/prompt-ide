import type { AgentPromptRejection } from '@shared/agentPasteText'
import type { AgentCliKind } from '@shared/agentCliKinds'
import type { AgentHistoryInfo } from '@shared/types'
import type { AgentActivity } from './agentActivity'
import type { ViewportLine } from './agentViewport'

// プロンプトの送信の手順(claudePromptSend.ts・copilotPromptSend.ts)と呼び出し側(useAgentPromptSender)が共有する型と時計
// (設計書 2026-10-22「送信の手順の表」)。手順は CLI の種類ごとの表(agentPromptSendSpecs.ts)から引く

/** 送り先の画面の活動が入力待ちでない(copilot の手順 3)。活動を足したときの決め忘れを型エラーにする */
export type AgentSendScreenFailure = `screen-${Exclude<AgentActivity, 'idle'>}`

export type AgentSendFailure =
  | AgentPromptRejection
  | 'not-accepting'
  | 'input-not-found'
  | 'clear-failed'
  | 'not-echoed'
  /** 送り先の CLI が送信に対応していない(useAgentPromptSender.send の先頭の守り。手順は返さない) */
  | 'unsupported-cli'
  /** 送り先のタブが中断の流れの間(useAgentPromptSender.send の先頭の守り。手順は返さない) */
  | 'interrupting'
  | AgentSendScreenFailure
  /** シェルのモード(copilot の手順 3) */
  | 'shell-mode'
  /** 入力欄に書きかけがある(copilot の手順 3。書きかけは消していない) */
  | 'draft-present'
  /** 上限まで入力欄が空か書きかけかを決められなかった(copilot の手順 3) */
  | 'input-undetermined'
  /** 貼り付けの後、echo を待つ間に入力欄がシェルのモードに変わった(copilot の手順 5。Enter は送っていない。本文が残りうる) */
  | 'shell-mode-after-paste'
  /** Enter の後に送れたことを確かめられなかった(copilot の手順 7。Enter は送り直していない) */
  | 'not-confirmed'

/** clearedDraft: 消去の前・途中に、入力欄が空でない(書きかけがある)と判定できたか(copilot は書きかけを消さないので常に false) */
export type AgentSendOutcome =
  | { kind: 'sent'; clearedDraft: boolean }
  | { kind: 'failed'; reason: AgentSendFailure }

/**
 * 送信の手順を含めた送信(useAgentPromptSender.send)の結果。送れたときは、送信の手順を始める時点に控えた送り先(履歴の
 * HistoryEntry.agent と同じ形。控えられなかったら null)と、送り先の CLI の種類(会話の ID を持たない種類は記録を黙って省く)を足す。
 * 送信の手順(表の send)の AgentSendOutcome は変えない
 */
export type AgentPromptSendResult =
  | (Extract<AgentSendOutcome, { kind: 'sent' }> & {
      sentTo: AgentHistoryInfo | null
      cliKind: AgentCliKind
    })
  | Extract<AgentSendOutcome, { kind: 'failed' }>

/** 送り先(agentTerminalController の一部)。write は利用者のキー入力の保留とは別に、直接 pty へ送る */
export interface AgentSendTarget {
  isBracketedPasteEnabled(): boolean
  /** 表示中の行(claude の手順が読む) */
  readViewport(): ViewportLine[]
  /** 画面の末尾の行(copilot の手順が読む。段階 2a の判定と同じ読み方。代替画面なので見え方は readViewport と同じ) */
  readScreen(): ViewportLine[]
  getCols(): number
  write(data: string): void
}

export interface AgentSendClock {
  now(): number
  sleep(ms: number): Promise<void>
}

export const realClock: AgentSendClock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms))
}
