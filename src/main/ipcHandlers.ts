import type { IpcMain } from 'electron'
import { app } from 'electron'
import { FolderAccessManager } from './folderAccessManager'
import { registerFileSystemHandlers } from './handlers/fileSystemHandlers'
import { registerGitHandlers } from './handlers/gitHandlers'
import { registerSettingsHandlers } from './handlers/settingsHandlers'
import { registerPromptsHandlers } from './handlers/promptsHandlers'
import { registerClaudeHandlers } from './handlers/claudeHandlers'

export function registerIpcHandlers(ipcMain: IpcMain): void {
  const folderAccess = new FolderAccessManager()

  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('destroyed', () => folderAccess.delete(webContents.id))
  })

  registerFileSystemHandlers(ipcMain, folderAccess)
  registerGitHandlers(ipcMain, folderAccess)
  registerSettingsHandlers(ipcMain)
  registerPromptsHandlers(ipcMain)
  registerClaudeHandlers(ipcMain)
}
