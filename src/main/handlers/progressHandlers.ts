import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { loadTasks, saveTasks } from '../progressStore'
import { toTask } from '../taskTransformer'

export function registerProgressHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('progress:load', async () => loadTasks())

  ipcMain.handle('progress:save', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (!Array.isArray(payload)) throw new Error('引数は配列である必要があります')
    let tasks
    try {
      tasks = payload.map(toTask)
    } catch (err) {
      throw new Error(
        `タスクデータの形式が不正です: ${err instanceof Error ? err.message : String(err)}`
      )
    }
    return saveTasks(tasks)
  })
}
