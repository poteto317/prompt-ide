import type { IpcMain } from 'electron'
import { resolve, relative } from 'path'
import { openFolderDialog } from './dialogService'
import { readDirRecursive, readFileContent } from './fileSystem'

function assertWithinFolder(folderPath: string, filePath: string): void {
  const rel = relative(folderPath, resolve(filePath))
  if (rel.startsWith('..')) {
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

  ipcMain.handle('fs:readDirectory', (_event, folderPath: string) =>
    readDirRecursive(folderPath)
  )

  ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
    if (allowedFolder === null) throw new Error('No folder open')
    assertWithinFolder(allowedFolder, filePath)
    return readFileContent(filePath)
  })
}
