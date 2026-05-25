import { ElectronAPI } from '@electron-toolkit/preload'
import type { FileTreeNode, GitStatusResult, Prompt } from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openFolder(): Promise<string | null>
      readDirectory(path: string): Promise<FileTreeNode[]>
      readFile(path: string): Promise<string>
      getGitStatus(): Promise<GitStatusResult>
      hasApiKey(): Promise<boolean>
      setApiKey(apiKey: string): Promise<void>
      runPrompt(promptContent: string, fileContent: string | null): Promise<string>
      loadPrompts(): Promise<Prompt[]>
      savePrompts(prompts: Prompt[]): Promise<void>
    }
  }
}
