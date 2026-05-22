import type { IpcMain } from 'electron'
import { sep } from 'path'
import { realpath } from 'node:fs/promises'
import { openFolderDialog } from './dialogService'
import { readDirRecursive, readFileContent } from './fileSystem'

async function assertWithinFolder(allowedRealpath: string, targetPath: string): Promise<void> {
  const resolvedTarget = await realpath(targetPath)
  const prefix = allowedRealpath.endsWith(sep) ? allowedRealpath : allowedRealpath + sep
  if (!resolvedTarget.startsWith(prefix)) {
    throw new Error(`Access denied: ${targetPath}`)
  }
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  let allowedFolder: string | null = null

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await openFolderDialog()
    if (result !== null) allowedFolder = await realpath(result)
    return result
  })

  ipcMain.handle('fs:readDirectory', async (_event, folderPath: string) => {
    if (allowedFolder === null) throw new Error('No folder open')
    const resolvedTarget = await realpath(folderPath)
    if (resolvedTarget !== allowedFolder) {
      throw new Error(`Access denied: ${folderPath}`)
    }
    return readDirRecursive(folderPath)
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    if (allowedFolder === null) throw new Error('No folder open')
    await assertWithinFolder(allowedFolder, filePath)
    return readFileContent(filePath)
  })
}
