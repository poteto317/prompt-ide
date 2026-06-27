export type CLIToolId = 'claude' | 'copilot' | 'api'

/** CLI プロセス経由で実行できるツール ID（'api' を除いた部分集合） */
export const CLI_ONLY_TOOL_IDS = ['claude', 'copilot'] as const
export type CLIOnlyToolId = (typeof CLI_ONLY_TOOL_IDS)[number]

export interface CLITool {
  id: CLIToolId
  label: string
}

export const CLI_TOOLS: CLITool[] = [
  { id: 'claude', label: 'Claude CLI' },
  { id: 'copilot', label: 'GitHub Copilot' },
  { id: 'api', label: 'Claude API' },
]
