import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { getApiKey, setApiKey } from '../apiKeyStore'
import { getModelSettings, setModelSettings } from '../modelSettingsStore'
import { parseModelSettingsPayload } from './settingsPayloadParser'
import {
  getAgentNotificationsEnabled,
  setAgentNotificationsEnabled
} from '../agentNotificationSettingStore'
import {
  getAgentSendConfirmEnabled,
  setAgentSendConfirmEnabled
} from '../agentSendConfirmSettingStore'
import { getAgentCliKindSetting, setAgentCliKind } from '../agentCliKindStore'
import { getPromptExecutionMode, setPromptExecutionMode } from '../executionModeStore'

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

  ipcMain.handle('settings:getPromptExecutionMode', async () => getPromptExecutionMode())

  ipcMain.handle(
    'settings:setPromptExecutionMode',
    async (_event: IpcMainInvokeEvent, mode: unknown): Promise<void> => setPromptExecutionMode(mode)
  )

  // 使うエージェント CLI。読み込みは種類と既定に戻した理由を返す(設定の画面が注記に使う)。検証は store が行う
  ipcMain.handle('settings:getAgentCliKind', async () => getAgentCliKindSetting())

  ipcMain.handle(
    'settings:setAgentCliKind',
    async (_event: IpcMainInvokeEvent, kind: unknown): Promise<void> => setAgentCliKind(kind)
  )

  ipcMain.handle('settings:getAgentNotificationsEnabled', async () =>
    getAgentNotificationsEnabled()
  )

  ipcMain.handle(
    'settings:setAgentNotificationsEnabled',
    async (_event: IpcMainInvokeEvent, enabled: unknown): Promise<void> =>
      setAgentNotificationsEnabled(enabled)
  )

  ipcMain.handle('settings:getAgentSendConfirmEnabled', async () => getAgentSendConfirmEnabled())

  ipcMain.handle(
    'settings:setAgentSendConfirmEnabled',
    async (_event: IpcMainInvokeEvent, enabled: unknown): Promise<void> =>
      setAgentSendConfirmEnabled(enabled)
  )
}
