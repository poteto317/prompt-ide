import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { app } from 'electron'
import { sep } from 'path'
import { realpath } from 'node:fs/promises'
import { openFolderDialog } from './dialogService'
import { readDirRecursive, readFileContent } from './fileSystem'
import { getGitStatus } from './gitService'
import { getApiKey, setApiKey } from './settingsStore'
import { runPrompt } from './claudeService'

async function assertWithinFolder(allowedRealpath: string, targetPath: string): Promise<void> {
  const resolvedTarget = await realpath(targetPath)
  const prefix = allowedRealpath.endsWith(sep) ? allowedRealpath : allowedRealpath + sep
  if (!resolvedTarget.startsWith(prefix)) {
    throw new Error(`Access denied: ${targetPath}`)
  }
}

export function registerIpcHandlers(ipcMain: IpcMain): void {
  const allowedFolders = new Map<number, string>()

  app.on('web-contents-created', (_event, webContents) => {
    webContents.on('destroyed', () => {
      allowedFolders.delete(webContents.id)
    })
  })

  ipcMain.handle('dialog:openFolder', async (event: IpcMainInvokeEvent) => {
    const result = await openFolderDialog()
    if (result !== null) allowedFolders.set(event.sender.id, await realpath(result))
    return result
  })

  ipcMain.handle('fs:readDirectory', async (event: IpcMainInvokeEvent, folderPath: string) => {
    const allowedFolder = allowedFolders.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    const resolvedTarget = await realpath(folderPath)
    if (resolvedTarget !== allowedFolder) {
      throw new Error(`Access denied: ${folderPath}`)
    }
    return readDirRecursive(folderPath)
  })

  ipcMain.handle('fs:readFile', async (event: IpcMainInvokeEvent, filePath: string) => {
    const allowedFolder = allowedFolders.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    await assertWithinFolder(allowedFolder, filePath)
    return readFileContent(filePath)
  })

  ipcMain.handle('git:getStatus', async (event: IpcMainInvokeEvent) => {
    const allowedFolder = allowedFolders.get(event.sender.id)
    if (allowedFolder === undefined) throw new Error('No folder open')
    return getGitStatus(allowedFolder)
  })

  ipcMain.handle('settings:getApiKey', async () => {
    const key = await getApiKey()
    return key.trim().length > 0
  })

  ipcMain.handle('settings:setApiKey', async (_event: IpcMainInvokeEvent, apiKey: string) => {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error('API キーが空です')
    }
    return setApiKey(apiKey.trim())
  })

  ipcMain.handle(
    'claude:runPrompt',
    async (
      _event: IpcMainInvokeEvent,
      { promptContent, fileContent }: { promptContent: string; fileContent: string | null }
    ) => {
      const apiKey = await getApiKey()
      if (apiKey.trim().length === 0) throw new Error('API キーが設定されていません')
      return runPrompt(apiKey, promptContent, fileContent)
    }
  )
}
