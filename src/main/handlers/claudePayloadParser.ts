export interface ClaudePayload {
  promptContent: string
  fileContent: string | null
}

export function parseClaudePayload(payload: unknown): ClaudePayload {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
    throw new Error('引数はオブジェクトである必要があります')
  }
  const { promptContent, fileContent } = payload as Record<string, unknown>
  if (typeof promptContent !== 'string') {
    throw new Error('promptContent は文字列である必要があります')
  }
  if (fileContent !== null && typeof fileContent !== 'string') {
    throw new Error('fileContent は文字列または null である必要があります')
  }
  return { promptContent, fileContent: fileContent as string | null }
}
