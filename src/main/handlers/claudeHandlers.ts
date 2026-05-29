import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { getApiKey } from '../settingsStore'
import { runPrompt } from '../claudeService'
import { parseClaudePayload } from './claudePayloadParser'

export function registerClaudeHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    'claude:runPrompt',
    async (_event: IpcMainInvokeEvent, payload: unknown) => {
      const { promptContent, fileContent } = parseClaudePayload(payload)
      const apiKey = await getApiKey()
      const trimmedKey = apiKey.trim()
      if (trimmedKey.length === 0) throw new Error('API キーが設定されていません')
      return runPrompt(trimmedKey, promptContent, fileContent)
    }
  )
}
