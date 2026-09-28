import { ipcRenderer } from 'electron'
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

export const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDirectory: (path: string): Promise<FileTreeNode[]> =>
    ipcRenderer.invoke('fs:readDirectory', path),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeFile', path, content),
  createFile: (parentPath: string, name: string): Promise<void> =>
    ipcRenderer.invoke('fs:createFile', parentPath, name),
  createDirectory: (parentPath: string, name: string): Promise<void> =>
    ipcRenderer.invoke('fs:createDirectory', parentPath, name),
  renameEntry: (path: string, newName: string): Promise<void> =>
    ipcRenderer.invoke('fs:renameEntry', path, newName),
  deleteEntry: (path: string): Promise<void> => ipcRenderer.invoke('fs:deleteEntry', path),
  getGitStatus: (): Promise<GitStatusResult> => ipcRenderer.invoke('git:getStatus'),
  stageFile: (filePath: string): Promise<void> => ipcRenderer.invoke('git:stage', filePath),
  unstageFile: (filePath: string, renamedFrom?: string): Promise<void> =>
    ipcRenderer.invoke('git:unstage', filePath, renamedFrom),
  commitChanges: (message: string): Promise<void> => ipcRenderer.invoke('git:commit', message),
  getDiff: (
    filePath: string,
    staged: boolean,
    isUntracked: boolean,
    renamedFrom?: string
  ): Promise<string> =>
    ipcRenderer.invoke('git:getDiff', filePath, staged, isUntracked, renamedFrom),
  stageHunk: (filePath: string, patch: string): Promise<void> =>
    ipcRenderer.invoke('git:stageHunk', filePath, patch),
  unstageHunk: (filePath: string, patch: string): Promise<void> =>
    ipcRenderer.invoke('git:unstageHunk', filePath, patch),
  getLog: (limit: number, skip: number): Promise<GitLogEntry[]> =>
    ipcRenderer.invoke('git:getLog', limit, skip),
  getBranches: (): Promise<GitBranch[]> => ipcRenderer.invoke('git:getBranches'),
  getTags: (): Promise<string[]> => ipcRenderer.invoke('git:getTags'),
  amendCommit: (message: string): Promise<void> => ipcRenderer.invoke('git:amendCommit', message),
  push: (): Promise<void> => ipcRenderer.invoke('git:push'),
  pull: (): Promise<void> => ipcRenderer.invoke('git:pull'),
  fetchRemote: (): Promise<void> => ipcRenderer.invoke('git:fetch'),
  checkoutBranch: (branchName: string): Promise<void> =>
    ipcRenderer.invoke('git:checkoutBranch', branchName),
  addToGitignore: (targetPath: string): Promise<void> =>
    ipcRenderer.invoke('fs:addToGitignore', targetPath),
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:hasApiKey'),
  setApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke('settings:setApiKey', apiKey),
  getModelSettings: (): Promise<ModelSettings> => ipcRenderer.invoke('settings:getModelSettings'),
  setModelSettings: (settings: ModelSettings): Promise<void> =>
    ipcRenderer.invoke('settings:setModelSettings', settings),
  runPromptStream: (
    requestId: string,
    promptContent: string,
    fileContent: string | null
  ): Promise<string> =>
    ipcRenderer.invoke('claude:runPromptStream', { requestId, promptContent, fileContent }),
  loadPrompts: (): Promise<Prompt[]> => ipcRenderer.invoke('prompts:load'),
  savePrompts: (prompts: Prompt[]): Promise<void> => ipcRenderer.invoke('prompts:save', prompts),
  exportPrompts: (prompts: Prompt[]): Promise<boolean> =>
    ipcRenderer.invoke('prompts:export', prompts),
  importPrompts: (): Promise<Prompt[] | null> => ipcRenderer.invoke('prompts:import'),
  loadTasks: (): Promise<Task[]> => ipcRenderer.invoke('progress:load'),
  saveTasks: (tasks: Task[]): Promise<void> => ipcRenderer.invoke('progress:save', tasks),
  runCLIPromptStream: (
    requestId: string,
    toolId: CLIOnlyToolId,
    promptContent: string
  ): Promise<string> =>
    ipcRenderer.invoke('cli:runPromptStream', { requestId, toolId, promptContent }),
  cancelPrompt: (requestId: string): Promise<boolean> =>
    ipcRenderer.invoke('prompt:cancel', { requestId }),
  // ipcRenderer を直接 renderer に渡さず preload 内で wrap し、解除関数を返す
  // (contextBridge 越しでは removeListener が正しく機能しないリスナーリークを防ぐ)
  onPromptStreamChunk: (listener: (requestId: string, chunk: string) => void): (() => void) => {
    const wrapped = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      if (typeof payload !== 'object' || payload === null) return
      const { requestId, chunk } = payload as Record<string, unknown>
      if (typeof requestId !== 'string' || typeof chunk !== 'string') return
      listener(requestId, chunk)
    }
    ipcRenderer.on('prompt:streamChunk', wrapped)
    return () => {
      ipcRenderer.removeListener('prompt:streamChunk', wrapped)
    }
  },
  loadHistory: (): Promise<HistoryEntry[]> => ipcRenderer.invoke('history:load'),
  saveHistory: (entries: HistoryEntry[]): Promise<void> =>
    ipcRenderer.invoke('history:save', entries)
}
