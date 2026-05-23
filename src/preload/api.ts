import { ipcRenderer } from 'electron'
import type { FileTreeNode, GitStatusResult } from '@shared/types'

export const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDirectory: (path: string): Promise<FileTreeNode[]> => ipcRenderer.invoke('fs:readDirectory', path),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
  getGitStatus: (): Promise<GitStatusResult> => ipcRenderer.invoke('git:getStatus'),
  hasApiKey: (): Promise<boolean> => ipcRenderer.invoke('settings:getApiKey'),
  setApiKey: (apiKey: string): Promise<void> => ipcRenderer.invoke('settings:setApiKey', apiKey),
  runPrompt: (promptContent: string, fileContent: string | null): Promise<string> =>
    ipcRenderer.invoke('claude:runPrompt', { promptContent, fileContent }),
}
