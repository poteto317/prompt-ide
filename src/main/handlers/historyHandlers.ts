import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { loadHistory, saveHistory } from '../historyStore'
import { isValidHistoryEntry, sanitizeHistoryEntry } from '../historyUtils'
import type { HistoryEntry } from '@shared/types'

function toHistoryEntry(item: unknown): HistoryEntry {
  if (!isValidHistoryEntry(item)) throw new Error('履歴データの形式が不正です')
  return sanitizeHistoryEntry(item)
}

export function registerHistoryHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('history:load', async () => loadHistory())

  ipcMain.handle('history:save', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (!Array.isArray(payload)) throw new Error('引数は配列である必要があります')
    return saveHistory(payload.map(toHistoryEntry))
  })
}
