import Anthropic from '@anthropic-ai/sdk'

export async function runPrompt(
  apiKey: string,
  promptContent: string,
  fileContent: string | null
): Promise<string> {
  const client = new Anthropic({ apiKey })
  const userMessage = fileContent !== null
    ? `${promptContent}\n\n---\n\n${fileContent}`
    : promptContent
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = message.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') {
    const first = message.content[0]
    const type = first ? first.type : 'なし'
    throw new Error(`予期しないレスポンス形式です（type: ${type}）`)
  }
  return block.text
}
