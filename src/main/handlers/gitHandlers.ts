import { resolve, dirname } from 'path'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import {
  getGitStatus,
  stageFile,
  unstageFile,
  commit,
  getDiff,
  stageHunk,
  unstageHunk,
  getLog,
  getBranches,
  getTags,
  amendCommit,
} from '../gitService'
import type { FolderAccessManager } from '../folderAccessManager'

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

// 削除済みファイル（もうディスク上に存在しない）に対する stage/unstage を許可するため、
// assertWithinFolder が ENOENT で失敗した場合のみ親ディレクトリの境界チェックにフォールバックする。
async function assertFileWithinFolder(
  folderAccess: FolderAccessManager,
  allowedFolder: string,
  resolvedPath: string
): Promise<void> {
  try {
    await folderAccess.assertWithinFolder(allowedFolder, resolvedPath)
  } catch (err) {
    if (!isEnoent(err)) throw err
    await folderAccess.assertParentWithinFolder(allowedFolder, dirname(resolvedPath))
  }
}

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
    await assertFileWithinFolder(folderAccess, allowedFolder, resolvedPath)
    await stageFile(allowedFolder, resolvedPath)
  })

  ipcMain.handle('git:unstage', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    const resolvedPath = resolve(allowedFolder, filePath)
    await assertFileWithinFolder(folderAccess, allowedFolder, resolvedPath)
    await unstageFile(allowedFolder, resolvedPath)
  })

  ipcMain.handle(
    'git:getDiff',
    async (event: IpcMainInvokeEvent, filePath: string, staged: boolean) => {
      const allowedFolder = folderAccess.get(event.sender.id)
      if (allowedFolder === undefined) throw new Error('No folder open')
      const resolvedPath = resolve(allowedFolder, filePath)
      await assertFileWithinFolder(folderAccess, allowedFolder, resolvedPath)
      return getDiff(allowedFolder, resolvedPath, staged)
    }
  )

  ipcMain.handle(
    'git:stageHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: string) => {
      const allowedFolder = folderAccess.get(event.sender.id)
      if (allowedFolder === undefined) throw new Error('No folder open')
      const resolvedPath = resolve(allowedFolder, filePath)
      await assertFileWithinFolder(folderAccess, allowedFolder, resolvedPath)
      await stageHunk(allowedFolder, resolvedPath, patch)
    }
  )

  ipcMain.handle(
    'git:unstageHunk',
    async (event: IpcMainInvokeEvent, filePath: string, patch: string) => {
      const allowedFolder = folderAccess.get(event.sender.id)
      if (allowedFolder === undefined) throw new Error('No folder open')
      const resolvedPath = resolve(allowedFolder, filePath)
      await assertFileWithinFolder(folderAccess, allowedFolder, resolvedPath)
      await unstageHunk(allowedFolder, resolvedPath, patch)
    }
  )

  ipcMain.handle('git:commit', async (event: IpcMainInvokeEvent, message: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await commit(allowedFolder, message)
  })

  ipcMain.handle('git:getLog', async (event: IpcMainInvokeEvent, limit: number, skip: number) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getLog(allowedFolder, limit, skip)
  })

  ipcMain.handle('git:getBranches', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getBranches(allowedFolder)
  })

  ipcMain.handle('git:getTags', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getTags(allowedFolder)
  })

  ipcMain.handle('git:amendCommit', async (event: IpcMainInvokeEvent, message: string) => {
    const allowedFolder = folderAccess.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await amendCommit(allowedFolder, message)
  })
}
