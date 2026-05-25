import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { getApiKey } from '../settingsStore'
import { runPrompt } from '../claudeService'

export function registerClaudeHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    'claude:runPrompt',
    async (_event: IpcMainInvokeEvent, payload: unknown) => {
      if (typeof payload !== 'object' || payload === null) {
        throw new Error('引数はオブジェクトである必要があります')
      }
      const { promptContent, fileContent } = payload as Record<string, unknown>
      if (typeof promptContent !== 'string') {
        throw new Error('promptContent は文字列である必要があります')
      }
      if (fileContent !== null && typeof fileContent !== 'string') {
        throw new Error('fileContent は文字列または null である必要があります')
      }
      const apiKey = await getApiKey()
      const trimmedKey = apiKey.trim()
      if (trimmedKey.length === 0) throw new Error('API キーが設定されていません')
      return runPrompt(trimmedKey, promptContent, fileContent)
    }
  )
}
