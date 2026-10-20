import type { AgentCliKind } from '../agentCliKinds'

export interface ModelOption {
  id: string
  label: string
  maxOutputTokens: number
}

export const AVAILABLE_MODELS = [
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', maxOutputTokens: 128000 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', maxOutputTokens: 128000 },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', maxOutputTokens: 128000 },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', maxOutputTokens: 64000 }
] as const satisfies readonly ModelOption[]

export type ModelId = (typeof AVAILABLE_MODELS)[number]['id']

export interface ModelSettings {
  modelId: ModelId
  maxTokens: number
}

export const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  modelId: 'claude-haiku-4-5',
  maxTokens: 4096
}

/** プロンプトの実行方式。agent-cli: アプリ内のターミナルの claude へ送る。legacy: Claude API・非対話の CLI(従来の方式) */
export const PROMPT_EXECUTION_MODES = ['agent-cli', 'legacy'] as const
export type PromptExecutionMode = (typeof PROMPT_EXECUTION_MODES)[number]
export const DEFAULT_PROMPT_EXECUTION_MODE: PromptExecutionMode = 'agent-cli'

export function isPromptExecutionMode(value: unknown): value is PromptExecutionMode {
  return typeof value === 'string' && (PROMPT_EXECUTION_MODES as readonly string[]).includes(value)
}

/** エージェントの完了・許可待ちの通知(OS の通知と Dock のバッジ)の既定。オン */
export const DEFAULT_AGENT_NOTIFICATIONS_ENABLED = true

/** エージェントへの送信前の確認(送る前に全文と送り先を確かめるダイアログ)の既定。オン */
export const DEFAULT_AGENT_SEND_CONFIRM_ENABLED = true

/** 使うエージェント CLI の設定の読み込みの結果(main の agentCliKindStore が返す)。fallback は既定に戻した理由。
 *  値が無い(未設定)なら null、値が壊れていたら invalid-value、設定ファイルを読めなかったら read-failed */
export type AgentCliKindSetting = {
  kind: AgentCliKind
  fallback: null | 'invalid-value' | 'read-failed'
}
