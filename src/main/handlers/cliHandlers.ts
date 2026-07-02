import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { runCLIPrompt } from '../cliService'
import { parseCliPayload } from './cliPayloadParser'

export function registerCLIHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    'cli:runPrompt',
    async (_event: IpcMainInvokeEvent, payload: unknown) => {
      const { toolId, promptContent } = parseCliPayload(payload)
      return runCLIPrompt(toolId, promptContent)
    }
  )
}
