import { ElectronAPI } from '@electron-toolkit/preload'
import type {
  CLIOnlyToolId,
  FileTreeNode,
  GitStatusResult,
  GitLogEntry,
  GitBranch,
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
      stageFile(filePath: string): Promise<void>
      unstageFile(filePath: string, renamedFrom?: string): Promise<void>
      commitChanges(message: string): Promise<void>
      getDiff(
        filePath: string,
        staged: boolean,
        isUntracked: boolean,
        renamedFrom?: string
      ): Promise<string>
      stageHunk(filePath: string, patch: string): Promise<void>
      unstageHunk(filePath: string, patch: string): Promise<void>
      getLog(limit: number, skip: number): Promise<GitLogEntry[]>
      getBranches(): Promise<GitBranch[]>
      getTags(): Promise<string[]>
      amendCommit(message: string): Promise<void>
      push(): Promise<void>
      pull(): Promise<void>
      fetchRemote(): Promise<void>
      addToGitignore(targetPath: string): Promise<void>
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
