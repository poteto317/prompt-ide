import type { CLIOnlyToolId } from '@shared/types'

export function runCLIPrompt(toolId: CLIOnlyToolId, promptContent: string): Promise<string> {
  return window.api.runCLIPrompt(toolId, promptContent)
}
