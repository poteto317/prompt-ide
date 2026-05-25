import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { loadPrompts, savePrompts } from '../promptStore'
import type { Prompt } from '@shared/types'

function isValidPrompt(item: unknown): item is Prompt {
  if (typeof item !== 'object' || item === null) return false
  const p = item as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.title === 'string' &&
    typeof p.content === 'string' &&
    typeof p.createdAt === 'number'
  )
}

function toPrompt(item: unknown): Prompt {
  if (!isValidPrompt(item)) throw new Error('プロンプトの形式が不正です')
  const { id, title, content, createdAt } = item
  return { id, title, content, createdAt }
}

export function registerPromptsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('prompts:load', async () => loadPrompts())

  ipcMain.handle('prompts:save', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (!Array.isArray(payload)) throw new Error('引数は配列である必要があります')
    return savePrompts(payload.map(toPrompt))
  })
}
