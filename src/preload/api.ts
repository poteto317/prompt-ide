import { ipcRenderer } from 'electron'
import type { FileTreeNode, GitStatusResult, Prompt, Task } from '@shared/types'

export const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDirectory: (path: string): Promise<FileTreeNode[]> =>
    ipcRenderer.invoke('fs:readDirectory', path),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  getGitStatus: (): Promise<GitStatusResult> => ipcRenderer.invoke('git:getStatus'),
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:hasApiKey'),
  setApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke('settings:setApiKey', apiKey),
  runPrompt: (promptContent: string, fileContent: string | null): Promise<string> =>
    ipcRenderer.invoke('claude:runPrompt', { promptContent, fileContent }),
  loadPrompts: (): Promise<Prompt[]> => ipcRenderer.invoke('prompts:load'),
  savePrompts: (prompts: Prompt[]): Promise<void> => ipcRenderer.invoke('prompts:save', prompts),
  exportPrompts: (prompts: Prompt[]): Promise<boolean> =>
    ipcRenderer.invoke('prompts:export', prompts),
  importPrompts: (): Promise<Prompt[] | null> => ipcRenderer.invoke('prompts:import'),
  loadTasks: (): Promise<Task[]> => ipcRenderer.invoke('progress:load'),
  saveTasks: (tasks: Task[]): Promise<void> => ipcRenderer.invoke('progress:save', tasks)
}
