import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { runCLIPrompt } from '../cliService'
import { parseCliPayload } from './cliPayloadParser'
import { registerCancellation } from '../cancellationRegistry'
import { createChunkSender, withCancellationCleanup } from './streamDelivery'

export function registerCLIHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('cli:runPromptStream', async (event: IpcMainInvokeEvent, payload: unknown) => {
    const { requestId, toolId, promptContent } = parseCliPayload(payload)
    return withCancellationCleanup(requestId, () =>
      runCLIPrompt(toolId, promptContent, {
        onChunk: createChunkSender(event, requestId),
        registerCancel: (cancel) => registerCancellation(requestId, cancel)
      })
    )
  })
}
