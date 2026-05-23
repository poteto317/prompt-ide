import { ElectronAPI } from '@electron-toolkit/preload'
import type { FileTreeNode, GitStatusResult } from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openFolder(): Promise<string | null>
      readDirectory(path: string): Promise<FileTreeNode[]>
      readFile(path: string): Promise<string>
      getGitStatus(): Promise<GitStatusResult>
      getApiKey(): Promise<string>
      setApiKey(apiKey: string): Promise<void>
      runPrompt(promptContent: string, fileContent: string | null): Promise<string>
    }
  }
}
