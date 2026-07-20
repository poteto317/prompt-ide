import type { CLIOnlyToolId } from '@shared/types'

export function runCLIPromptStream(
  requestId: string,
  toolId: CLIOnlyToolId,
  promptContent: string
): Promise<string> {
  return window.api.runCLIPromptStream(requestId, toolId, promptContent)
}
