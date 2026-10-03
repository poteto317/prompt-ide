import type { IpcMain } from 'electron'
import { app } from 'electron'
import { FolderAccessManager } from './folderAccessManager'
import { setupFolderAccessLifecycle } from './folderAccessLifecycle'
import { registerFileSystemHandlers } from './handlers/fileSystemHandlers'
import { registerGitHandlers } from './handlers/gitHandlers'
import { registerCloneHandlers } from './handlers/cloneHandlers'
import { CloneRegistry } from './cloneRegistry'
import { setupCloneLifecycle } from './cloneLifecycle'
import { registerSettingsHandlers } from './handlers/settingsHandlers'
import { registerPromptsHandlers } from './handlers/promptsHandlers'
import { registerProgressHandlers } from './handlers/progressHandlers'
import { registerClaudeHandlers } from './handlers/claudeHandlers'
import { registerCLIHandlers } from './handlers/cliHandlers'
import { registerPromptCancelHandlers } from './handlers/promptCancelHandlers'
import { registerHistoryHandlers } from './handlers/historyHandlers'

export function registerIpcHandlers(ipcMain: IpcMain): void {
  const folderAccess = new FolderAccessManager()

  setupFolderAccessLifecycle(app, folderAccess)

  registerFileSystemHandlers(ipcMain, folderAccess)
  registerGitHandlers(ipcMain, folderAccess)
  // clone は成功したフォルダを開く許可に切り替えるため、同じ FolderAccessManager を渡す
  const cloneRegistry = new CloneRegistry()
  setupCloneLifecycle(app, cloneRegistry)
  registerCloneHandlers(ipcMain, folderAccess, cloneRegistry)
  registerSettingsHandlers(ipcMain)
  registerPromptsHandlers(ipcMain)
  registerProgressHandlers(ipcMain)
  registerClaudeHandlers(ipcMain)
  registerCLIHandlers(ipcMain)
  registerPromptCancelHandlers(ipcMain)
  registerHistoryHandlers(ipcMain)
}
