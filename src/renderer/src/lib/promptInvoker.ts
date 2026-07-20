import * as claudeApi from './claudeApi'
import * as cliApi from './cliApi'
import type { PromptToolId } from '@shared/types'
import { buildPromptContent } from '@shared/promptUtils'

export async function invokePrompt(
  toolId: PromptToolId,
  promptContent: string,
  fileContent: string | null,
  requestId: string
): Promise<string> {
  if (toolId === 'api') {
    return claudeApi.runPromptStream(requestId, promptContent, fileContent)
  }
  return cliApi.runCLIPromptStream(
    requestId,
    toolId,
    buildPromptContent(promptContent, fileContent)
  )
}
