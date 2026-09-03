import { resolve } from 'path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { getGitStatus, stageFile, unstageFile, commit } from '../gitService'
import type { FolderAccessManager } from '../folderAccessManager'

export function registerGitHandlers(ipcMain: IpcMain, folderAccess: FolderAccessManager): void {
  ipcMain.handle('git:getStatus', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getGitStatus(allowedFolder)
  })

  ipcMain.handle('git:stage', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    const resolvedPath = resolve(allowedFolder, filePath)
    await folderAccess.assertWithinFolder(allowedFolder, resolvedPath)
    await stageFile(allowedFolder, resolvedPath)
  })

  ipcMain.handle('git:unstage', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    const resolvedPath = resolve(allowedFolder, filePath)
    await folderAccess.assertWithinFolder(allowedFolder, resolvedPath)
    await unstageFile(allowedFolder, resolvedPath)
  })

  ipcMain.handle('git:commit', async (event: IpcMainInvokeEvent, message: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await commit(allowedFolder, message)
  })
}
