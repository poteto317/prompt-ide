import type { CLIOnlyToolId } from '@shared/types'
import { CLI_ONLY_TOOL_IDS } from '@shared/types'

export interface CliPayload {
  toolId: CLIOnlyToolId
  promptContent: string
}

export function parseCliPayload(payload: unknown): CliPayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('引数はオブジェクトである必要があります')
  }
  const { toolId, promptContent } = payload as Record<string, unknown>
  if (typeof toolId !== 'string') {
    throw new Error('toolId は文字列である必要があります')
  }
  if (!(CLI_ONLY_TOOL_IDS as readonly string[]).includes(toolId)) {
    const allowed = CLI_ONLY_TOOL_IDS.map((id) => `'${id}'`).join(' または ')
    throw new Error(`toolId は ${allowed} である必要があります（受け取った値: ${toolId}）`)
  }
  if (typeof promptContent !== 'string') {
    throw new Error('promptContent は文字列である必要があります')
  }
  if (promptContent.trim().length === 0) {
    throw new Error('promptContent は空文字列にできません')
  }
  return { toolId: toolId as CLIOnlyToolId, promptContent }
}
