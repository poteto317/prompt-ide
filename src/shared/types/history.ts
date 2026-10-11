import type { PromptToolId } from './cli'

/** 成功・エラーは従来の方式の実行の結果。sent はエージェント CLI 方式で送れたこと(結果は知らない。agent があるときかつそのときだけ) */
export type HistoryStatus = 'success' | 'error' | 'sent'

/** エージェント CLI 方式で送ったときの送り先(送信の手順を始める時点に控えたタブの状態とフォルダ)。送信の onSent・describeSession も同じ型 */
export interface AgentHistoryInfo {
  /** 送り先のタブで動いていた claude の会話の ID(UUID) */
  claudeSessionId: string
  /** 送り先のタブの名前(claude 2 など) */
  tabLabel: string
  /** 送ったときに開いていたフォルダ(renderer の文字列) */
  folderPath: string
}

export type HistoryEntry = {
  id: string
  promptId: string | null
  promptTitle: string
  promptContent: string
  fileContent: string | null
  toolId: PromptToolId
  status: HistoryStatus
  resultText: string | null
  errorMessage: string | null
  executedAt: number
  /** エージェント CLI 方式で送ったエントリの送り先。従来の方式のエントリは null(省略させない。L-060) */
  agent: AgentHistoryInfo | null
}
