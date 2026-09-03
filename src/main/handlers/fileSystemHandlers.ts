import { realpath } from 'node:fs/promises'
import { join, dirname, relative } from 'node:path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { openFolderDialog } from '../dialogService'
import {
  readDirRecursive,
  readFileContent,
  writeFileContent,
  createFile,
  createDirectory,
  renameEntry,
  deleteEntry,
  addToGitignore
} from '../fileSystem'
import type { FolderAccessManager } from '../folderAccessManager'
import { getAllowedFolder, assertFileAccess } from './fileAccessGuard'
import { assertValidEntryName } from './entryNameValidator'
import { convertFsError, convertFsAccessError } from './fsErrorConverter'

// fs:createFile と fs:createDirectory は、実際に呼び出す fs 操作以外は
// 名前検証・アクセス境界チェック・エラー変換まで全く同じ流れのため共通化する
function registerCreateEntryHandler(
  ipcMain: IpcMain,
  folderAccess: FolderAccessManager,
  channel: 'fs:createFile' | 'fs:createDirectory',
  createEntry: (path: string) => Promise<void>
): void {
  ipcMain.handle(channel, async (event: IpcMainInvokeEvent, parentPath: string, name: string) => {
    assertValidEntryName(name)
    const allowedFolder = getAllowedFolder(folderAccess, event)
    try {
      const resolvedParent = await folderAccess.assertParentWithinFolder(allowedFolder, parentPath)
      await createEntry(join(resolvedParent, name))
    } catch (err) {
      throw convertFsError(err, name, parentPath)
    }
  })
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
      throw convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
    }
  })

  ipcMain.handle(
    'fs:writeFile',
    async (event: IpcMainInvokeEvent, filePath: string, content: string) => {
      try {
        await assertFileAccess(folderAccess, event, filePath)
        return await writeFileContent(filePath, content)
      } catch (err) {
        throw convertFsAccessError(err, `ファイルが見つかりません: ${filePath}`, filePath)
      }
    }
  )

  registerCreateEntryHandler(ipcMain, folderAccess, 'fs:createFile', createFile)
  registerCreateEntryHandler(ipcMain, folderAccess, 'fs:createDirectory', createDirectory)

  ipcMain.handle(
    'fs:renameEntry',
    async (event: IpcMainInvokeEvent, targetPath: string, newName: string) => {
      assertValidEntryName(newName)
      const allowedFolder = getAllowedFolder(folderAccess, event)
      try {
        // assertWithinFolder は「許可フォルダの内部」のみ許可するため、
        // ルートフォルダ自体のリネームはここで自動的に拒否される
        await folderAccess.assertWithinFolder(allowedFolder, targetPath)
        await renameEntry(targetPath, join(dirname(targetPath), newName))
      } catch (err) {
        throw convertFsError(err, newName, targetPath)
      }
    }
  )

  ipcMain.handle('fs:deleteEntry', async (event: IpcMainInvokeEvent, targetPath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    try {
      // assertWithinFolder により、ルートフォルダ自体の削除は自動的に拒否される
      await folderAccess.assertWithinFolder(allowedFolder, targetPath)
      await deleteEntry(targetPath)
    } catch (err) {
      throw convertFsAccessError(err, `対象が見つかりません: ${targetPath}`, targetPath)
    }
  })

  ipcMain.handle('fs:addToGitignore', async (event: IpcMainInvokeEvent, targetPath: string) => {
    const allowedFolder = getAllowedFolder(folderAccess, event)
    await folderAccess.assertWithinFolder(allowedFolder, targetPath)
    const relativePath = relative(allowedFolder, targetPath)
    await addToGitignore(allowedFolder, relativePath)
  })
}
