import Anthropic from '@anthropic-ai/sdk'
import { buildPromptContent } from '@shared/promptUtils'

export interface RunPromptStreamOptions {
  model: string
  maxTokens: number
  signal?: AbortSignal
  onChunk?: (chunk: string) => void
}

export async function runPromptStream(
  apiKey: string,
  promptContent: string,
  fileContent: string | null,
  options: RunPromptStreamOptions
): Promise<string> {
  const client = new Anthropic({ apiKey })
  const userMessage = buildPromptContent(promptContent, fileContent)
  const stream = client.messages.stream(
    {
      model: options.model,
      max_tokens: options.maxTokens,
      messages: [{ role: 'user', content: userMessage }]
    },
    { signal: options.signal }
  )
  if (options.onChunk) stream.on('text', options.onChunk)

  try {
    const message = await stream.finalMessage()
    const block = message.content.find((b) => b.type === 'text')
    if (!block || block.type !== 'text') {
      const first = message.content[0]
      const type = first ? first.type : 'なし'
      throw new Error(`予期しないレスポンス形式です（type: ${type}）`)
    }
    return block.text
  } catch (err) {
    if (err instanceof Anthropic.APIUserAbortError) {
      throw new Error('キャンセルされました')
    }
    throw err
  }
}
