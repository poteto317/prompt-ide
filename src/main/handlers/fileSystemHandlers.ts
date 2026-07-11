import { realpath } from 'node:fs/promises'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { openFolderDialog } from '../dialogService'
import { readDirRecursive, readFileContent, writeFileContent } from '../fileSystem'
import type { FolderAccessManager } from '../folderAccessManager'

function getAllowedFolder(folderAccess: FolderAccessManager, event: IpcMainInvokeEvent): string {
  const allowedFolder = folderAccess.get(event.sender.id)
  if (allowedFolder === undefined) throw new Error('No folder open')
  return allowedFolder
}

async function assertFileAccess(
  folderAccess: FolderAccessManager,
  event: IpcMainInvokeEvent,
  filePath: string
): Promise<void> {
  const allowedFolder = getAllowedFolder(folderAccess, event)
  await folderAccess.assertWithinFolder(allowedFolder, filePath)
}

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
    const allowedFolder = getAllowedFolder(folderAccess, event)
    const resolvedTarget = await realpath(folderPath)
    if (resolvedTarget !== allowedFolder) {
      throw new Error(`Access denied: ${folderPath}`)
    }
    return readDirRecursive(folderPath)
  })

  ipcMain.handle('fs:readFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    try {
      await assertFileAccess(folderAccess, event, filePath)
      return await readFileContent(filePath)
    } catch (err) {
      if (isEnoentError(err)) {
        throw new Error(`ファイルが見つかりません: ${filePath}`)
      }
      throw err
    }
  })

  ipcMain.handle(
    'fs:writeFile',
    async (event: IpcMainInvokeEvent, filePath: string, content: string) => {
      try {
        await assertFileAccess(folderAccess, event, filePath)
        return await writeFileContent(filePath, content)
      } catch (err) {
        if (isEnoentError(err)) {
          throw new Error(`ファイルが見つかりません: ${filePath}`)
        }
        throw err
      }
    }
  )
}

function isEnoentError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
