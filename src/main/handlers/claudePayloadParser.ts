import { assertPlainObject, assertRequestId } from './payloadValidators'

export interface ClaudePayload {
  requestId: string
  promptContent: string
  fileContent: string | null
}

export function parseClaudePayload(payload: unknown): ClaudePayload {
  assertPlainObject(payload)
  const { requestId, promptContent, fileContent } = payload
  assertRequestId(requestId)
  if (typeof promptContent !== 'string') {
    throw new Error('promptContent は文字列である必要があります')
  }
  if (!(fileContent === null || typeof fileContent === 'string')) {
    throw new Error('fileContent は文字列または null である必要があります')
  }
  return { requestId, promptContent, fileContent }
}
