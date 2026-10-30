import type { CLIOnlyToolId } from '@shared/types'
import { CLI_ONLY_TOOL_IDS } from '@shared/types'
import { isOneOf } from '@shared/typeGuards'
import { assertPlainObject, assertRequestId } from './payloadValidators'

export interface CliPayload {
  requestId: string
  toolId: CLIOnlyToolId
  promptContent: string
}

export function parseCliPayload(payload: unknown): CliPayload {
  assertPlainObject(payload)
  const { requestId, toolId, promptContent } = payload
  assertRequestId(requestId)
  if (typeof toolId !== 'string') {
    throw new Error('toolId は文字列である必要があります')
  }
  if (!isOneOf(CLI_ONLY_TOOL_IDS, toolId)) {
    const allowed = CLI_ONLY_TOOL_IDS.map((id) => `'${id}'`).join(' または ')
    throw new Error(`toolId は ${allowed} である必要があります（受け取った値: ${toolId}）`)
  }
  if (typeof promptContent !== 'string') {
    throw new Error('promptContent は文字列である必要があります')
  }
  if (promptContent.trim().length === 0) {
    throw new Error('promptContent は空文字列にできません')
  }
  return { requestId, toolId, promptContent }
}
