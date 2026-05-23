import Anthropic from '@anthropic-ai/sdk'

export async function runPrompt(
  apiKey: string,
  promptContent: string,
  fileContent: string | null
): Promise<string> {
  const client = new Anthropic({ apiKey })
  const userMessage = fileContent
    ? `${promptContent}\n\n---\n\n${fileContent}`
    : promptContent
  const message = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: userMessage }],
  })
  const block = message.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type')
  return block.text
}
