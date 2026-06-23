import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { loadPrompts, savePrompts } from '../promptStore'
import { isValidPrompt, sanitizePrompt } from '../promptUtils'
import { exportPromptsToFile, importPromptsFromFile } from '../promptTransferService'
import type { Prompt } from '@shared/types'

function toPrompt(item: unknown): Prompt {
  if (!isValidPrompt(item)) throw new Error('プロンプトの形式が不正です')
  return sanitizePrompt(item)
}

export function registerPromptsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('prompts:load', async () => loadPrompts())

  ipcMain.handle('prompts:save', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (!Array.isArray(payload)) throw new Error('引数は配列である必要があります')
    return savePrompts(payload.map(toPrompt))
  })

  ipcMain.handle('prompts:export', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (!Array.isArray(payload)) throw new Error('引数は配列である必要があります')
    return exportPromptsToFile(payload.map(toPrompt))
  })

  ipcMain.handle('prompts:import', () => importPromptsFromFile())
}
