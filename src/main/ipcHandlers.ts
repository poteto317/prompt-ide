import type { IpcMain } from 'electron'
import { openFolderDialog } from './dialogService'
import { readDirRecursive, readFileContent } from './fileSystem'

export function registerIpcHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('dialog:openFolder', () => openFolderDialog())
  ipcMain.handle('fs:readDirectory', (_event, folderPath: string) => readDirRecursive(folderPath))
  ipcMain.handle('fs:readFile', (_event, filePath: string) => readFileContent(filePath))
}
