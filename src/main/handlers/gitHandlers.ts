import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { getGitStatus } from '../gitService'
import type { FolderAccessManager } from '../folderAccessManager'

export function registerGitHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager): void {
  ipcMain.handle('git:getStatus', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getGitStatus(allowedFolder)
  })
}
