export function cancelPrompt(requestId: string): Promise<boolean> {
  return window.api.cancelPrompt(requestId)
}

export function onPromptStreamChunk(
  listener: (requestId: string, chunk: string) => void
): () => void {
  return window.api.onPromptStreamChunk(listener)
}
