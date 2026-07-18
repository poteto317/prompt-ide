import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { cancelRequest } from '../cancellationRegistry'
import { assertPlainObject, assertRequestId } from './payloadValidators'

export function registerPromptCancelHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('prompt:cancel', async (_event: IpcMainInvokeEvent, payload: unknown) => {
    assertPlainObject(payload)
    const { requestId } = payload
    assertRequestId(requestId)
    // 既に完了済みの requestId は false になるが、キャンセル操作としては正常系なので throw しない
    return cancelRequest(requestId)
  })
}
