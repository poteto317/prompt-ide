export function buildPromptContent(promptContent: string, fileContent: string | null): string {
  return fileContent !== null ? `${promptContent}\n\n---\n\n${fileContent}` : promptContent
}
