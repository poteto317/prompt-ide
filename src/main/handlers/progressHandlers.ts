import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { loadTasks, saveTasks } from '../progressStore'
import { toTask } from '../taskTransformer'

export function registerProgressHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('progress:load', async () => loadTasks())

  ipcMain.handle('progress:save', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (!Array.isArray(payload)) throw new Error('引数は配列である必要があります')
    return saveTasks(payload.map(toTask))
  })
}
