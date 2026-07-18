import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { getApiKey, setApiKey } from '../apiKeyStore'
import { getModelSettings, setModelSettings } from '../modelSettingsStore'
import { parseModelSettingsPayload } from './settingsPayloadParser'

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle('settings:hasApiKey', async () => {
    const key = await getApiKey()
    return key.trim().length > 0
  })

  ipcMain.handle('settings:setApiKey', async (_event: IpcMainInvokeEvent, apiKey: string) => {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      throw new Error('API キーが空です')
    }
    return setApiKey(apiKey.trim())
  })

  ipcMain.handle('settings:getModelSettings', async () => {
    return getModelSettings()
  })

  ipcMain.handle(
    'settings:setModelSettings',
    async (_event: IpcMainInvokeEvent, payload: unknown) => {
      const settings = parseModelSettingsPayload(payload)
      return setModelSettings(settings)
    }
  )
}
