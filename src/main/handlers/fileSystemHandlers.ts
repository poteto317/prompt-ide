import { realpath } from 'node:fs/promises'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { openFolderDialog } from '../dialogService'
import { readDirRecursive, readFileContent } from '../fileSystem'
import type { FolderAccessManager } from '../folderAccessManager'

export function registerFileSystemHandlers(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager
): void {
  ipcMain.handle('dialog:openFolder', async (event: IpcMainInvokeEvent) => {
    const result = await openFolderDialog()
    if (result !== null) folderAccess.set(event.sender.id, await realpath(result))
    return result
  })

  ipcMain.handle('fs:readDirectory', async (event: IpcMainInvokeEvent, folderPath: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    const resolvedTarget = await realpath(folderPath)
    if (resolvedTarget !== allowedFolder) {
      throw new Error(`Access denied: ${folderPath}`)
    }
    return readDirRecursive(folderPath)
  })

  ipcMain.handle('fs:readFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await folderAccess.assertWithinFolder(allowedFolder, filePath)
    return readFileContent(filePath)
  })
}
