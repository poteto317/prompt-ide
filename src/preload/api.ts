import { ipcRenderer } from 'electron'
import type { FileTreeNode } from '../renderer/src/types'

export const api = {
  openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  readDirectory: (path: string): Promise<FileTreeNode[]> => ipcRenderer.invoke('fs:readDirectory', path),
  readFile: (path: string): Promise<string> => ipcRenderer.invoke('fs:readFile', path),
}
