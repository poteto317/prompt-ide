import * as claudeApi from './claudeApi'
import * as cliApi from './cliApi'
import type { CLIToolId } from '@shared/types'
import { buildPromptContent } from '@shared/promptUtils'

export async function invokePrompt(
  toolId: CLIToolId,
  promptContent: string,
  fileContent: string | null
): Promise<string> {
  if (toolId === 'api') {
    return claudeApi.runPrompt(promptContent, fileContent)
  }
  return cliApi.runCLIPrompt(toolId, buildPromptContent(promptContent, fileContent))
}
