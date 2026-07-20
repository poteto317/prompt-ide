import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  CLIOnlyToolId,
  FileTreeNode,
  GitStatusResult,
  HistoryEntry,
  ModelSettings,
  Prompt,
  Task
} from '@shared/types'

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      openFolder(): Promise<string | null>
      readDirectory(path: string): Promise<FileTreeNode[]>
      readFile(path: string): Promise<string>
      writeFile(path: string, content: string): Promise<void>
      createFile(parentPath: string, name: string): Promise<void>
      createDirectory(parentPath: string, name: string): Promise<void>
      renameEntry(path: string, newName: string): Promise<void>
      deleteEntry(path: string): Promise<void>
      getGitStatus(): Promise<GitStatusResult>
      hasApiKey(): Promise<boolean>
      setApiKey(apiKey: string): Promise<void>
      getModelSettings(): Promise<ModelSettings>
      setModelSettings(settings: ModelSettings): Promise<void>
      runPromptStream(
        requestId: string,
        promptContent: string,
        fileContent: string | null
      ): Promise<string>
      loadPrompts(): Promise<Prompt[]>
      savePrompts(prompts: Prompt[]): Promise<void>
      exportPrompts(prompts: Prompt[]): Promise<boolean>
      importPrompts(): Promise<Prompt[] | null>
      loadTasks(): Promise<Task[]>
      saveTasks(tasks: Task[]): Promise<void>
      runCLIPromptStream(
        requestId: string,
        toolId: CLIOnlyToolId,
        promptContent: string
      ): Promise<string>
      cancelPrompt(requestId: string): Promise<boolean>
      onPromptStreamChunk(listener: (requestId: string, chunk: string) => void): () => void
      loadHistory(): Promise<HistoryEntry[]>
      saveHistory(entries: HistoryEntry[]): Promise<void>
    }
  }
}
