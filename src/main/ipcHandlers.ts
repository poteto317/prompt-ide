import type { IpcMain } from 'electron'
import { app } from 'electron'
import { FolderAccessManager } from './folderAccessManager'
import { setupFolderAccessLifecycle } from './folderAccessLifecycle'
import { registerFileSystemHandlers } from './handlers/fileSystemHandlers'
import { registerGitHandlers } from './handlers/gitHandlers'
import { registerSettingsHandlers } from './handlers/settingsHandlers'
import { registerPromptsHandlers } from './handlers/promptsHandlers'
import { registerProgressHandlers } from './handlers/progressHandlers'
import { registerClaudeHandlers } from './handlers/claudeHandlers'
import { registerCLIHandlers } from './handlers/cliHandlers'

export function registerIpcHandlers(ipcMain: IpcMain): void {
  const folderAccess = new FolderAccessManager()

  setupFolderAccessLifecycle(app, folderAccess)

  registerFileSystemHandlers(ipcMain, folderAccess)
  registerGitHandlers(ipcMain, folderAccess)
  registerSettingsHandlers(ipcMain)
  registerPromptsHandlers(ipcMain)
  registerProgressHandlers(ipcMain)
  registerClaudeHandlers(ipcMain)
  registerCLIHandlers(ipcMain)
}
