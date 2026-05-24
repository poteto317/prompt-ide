export function hasApiKey(): Promise<boolean> {
  return window.api.hasApiKey()
}

export function setApiKey(apiKey: string): Promise<void> {
  return window.api.setApiKey(apiKey)
}

export function runPrompt(promptContent: string, fileContent: string | null): Promise<string> {
  return window.api.runPrompt(promptContent, fileContent)
}
