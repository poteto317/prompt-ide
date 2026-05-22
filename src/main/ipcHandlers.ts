import type { IpcMain } from 'electron'
import { resolve, sep } from 'path'
import { openFolderDialog } from './dialogService'
import { readDirRecursive, readFileContent } from './fileSystem'

function assertWithinFolder(folderPath: string, filePath: string): void {
  const resolvedFolder = resolve(folderPath)
  const resolvedFile = resolve(filePath)
  if (!resolvedFile.startsWith(resolvedFolder + sep)) {
    throw new Error(`Access denied: ${filePath}`)
  }
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  let allowedFolder: string | null = null

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await openFolderDialog()
    if (result !== null) allowedFolder = result
    return result
  })

  ipcMain.handle('fs:readDirectory', async (_event, folderPath: string) => {
    if (allowedFolder === null) throw new Error('No folder open')
    if (resolve(folderPath) !== resolve(allowedFolder)) {
      throw new Error(`Access denied: ${folderPath}`)
    }
    return readDirRecursive(folderPath)
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    if (allowedFolder === null) throw new Error('No folder open')
    assertWithinFolder(allowedFolder, filePath)
    return readFileContent(filePath)
  })
}
