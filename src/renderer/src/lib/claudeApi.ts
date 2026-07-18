export function hasApiKey(): Promise<boolean> {
  return window.api.hasApiKey()
}

export function setApiKey(apiKey: string): Promise<void> {
  return window.api.setApiKey(apiKey)
}

export function runPromptStream(
  requestId: string,
  promptContent: string,
  fileContent: string | null
): Promise<string> {
  return window.api.runPromptStream(requestId, promptContent, fileContent)
}
