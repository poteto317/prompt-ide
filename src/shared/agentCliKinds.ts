// エージェント CLI 方式で起動する CLI の種類と、CLI ごとに使えるアプリの機能の表(設計書 2026-10-20「型と能力の表」)。
// main(起動・hooks・再開の拒否)と renderer(入口の判定・文言)が同じ表を読む。従来の方式の PromptToolId とは別の型
import { isOneOf } from './typeGuards'

/** エージェント CLI 方式で起動する CLI の種類。main の起動の表と renderer の入口の判定が同じ値を使う */
export const AGENT_CLI_KINDS = ['claude', 'copilot'] as const
export type AgentCliKind = (typeof AGENT_CLI_KINDS)[number]
export const DEFAULT_AGENT_CLI_KIND: AgentCliKind = 'claude'

export function isAgentCliKind(value: unknown): value is AgentCliKind {
  return isOneOf(AGENT_CLI_KINDS, value)
}

/** CLI ごとに、アプリの機能が使えるか(CLI ごとの画面・引数・hooks に依存する機能) */
export interface AgentCliCapabilities {
  /** 実行ボタン・履歴の再実行・送信前の確認からの送信(入力欄の判定・貼り付け)。押せる条件と手順は renderer の agentPromptSendSpecs.ts */
  promptSend: boolean
  /** 画面からの活動の判定と、それに基づく表示・完了と許可待ちの通知・変更の一覧の自動の取り直し */
  screenActivity: boolean
  /** 帯の中断(送り方は main の agentCliInterruptSpecs.ts。claude は Esc を 1 回、copilot は 2 回)。押せる条件が screenActivity の
   *  working なので、true なら screenActivity も true */
  interrupt: boolean
  /** hooks によるエージェントの変更と利用者の変更の区別と、画面の作業中・作業の終わりを main の区間の追跡へ知らせること(claude は --settings、
   *  copilot は --plugin-dir で 1 回の起動だけに効く hooks を渡す。copilot はツールの呼び出しの ID が無いため区別が粗い。段階 3b) */
  changeAttribution: boolean
  /** 前回の続きから・このセッションで再開・種類ごとの起動の記録(main の agentSessionRecordFileIo.ts の表)・会話の ID の予約 */
  sessionResume: boolean
}

export interface AgentCliProfile {
  /** 設定の画面の名前(Claude Code / GitHub Copilot CLI) */
  displayName: string
  /** 起動するコマンドの名前(main の探索に使う)。タブの名前・文言にも使う */
  commandName: string
  capabilities: AgentCliCapabilities
}

export const AGENT_CLI_PROFILES: Record<AgentCliKind, AgentCliProfile> = {
  claude: {
    displayName: 'Claude Code',
    commandName: 'claude',
    capabilities: {
      promptSend: true,
      screenActivity: true,
      interrupt: true,
      changeAttribution: true,
      sessionResume: true
    }
  },
  copilot: {
    displayName: 'GitHub Copilot CLI',
    commandName: 'copilot',
    capabilities: {
      promptSend: true,
      screenActivity: true,
      interrupt: true,
      changeAttribution: true,
      sessionResume: true
    }
  }
}

/** 既定の CLI(claude)のコマンド名。renderer の文言の「claude を使っています」「claude に戻すと使えます」に使う */
export const DEFAULT_AGENT_CLI_COMMAND_NAME = AGENT_CLI_PROFILES[DEFAULT_AGENT_CLI_KIND].commandName

export function agentCliCapabilities(kind: AgentCliKind): AgentCliCapabilities {
  return AGENT_CLI_PROFILES[kind].capabilities
}
