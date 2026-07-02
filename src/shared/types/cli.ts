export type PromptToolId = 'claude' | 'copilot' | 'api'

/** CLI プロセス経由で実行できるツール ID（'api' を除いた部分集合） */
export const CLI_ONLY_TOOL_IDS = ['claude', 'copilot'] as const
export type CLIOnlyToolId = (typeof CLI_ONLY_TOOL_IDS)[number]

export interface PromptTool {
  id: PromptToolId
  label: string
}

export const EXECUTION_TOOLS = [
  { id: 'claude', label: 'Claude CLI' },
  { id: 'copilot', label: 'GitHub Copilot' },
  { id: 'api', label: 'Claude API' },
] as const satisfies readonly PromptTool[]
