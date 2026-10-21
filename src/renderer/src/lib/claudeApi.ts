import type { ApiKeyStatus } from '@shared/apiKeyStatus'

/** API キーの状態。読み込みの失敗は reject せず、理由の種類で返る */
export function hasApiKey(): Promise<ApiKeyStatus> {
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
