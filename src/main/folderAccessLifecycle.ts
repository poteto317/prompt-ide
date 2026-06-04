import type { App } from 'electron'
import type { FolderAccessManager } from './folderAccessManager'

export function setupFolderAccessLifecycle(app: App, folderAccess: FolderAccessManager): void {
  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('destroyed', () => folderAccess.delete(webContents.id))
  })
}
