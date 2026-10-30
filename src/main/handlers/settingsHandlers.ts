import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import type { ApiKeyStatus } from '@shared/apiKeyStatus'
import { getApiKey, setApiKey } from '../apiKeyStore'
import { toApiKeyLoadFailureReason } from '../apiKeyErrors'
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
import { getPromptListMode, setPromptListMode } from '../promptListModeStore'

export function registerSettingsHandlers(ipcMain: IpcMain): void {
  // API キーの状態。読み込みの失敗は reject せず理由の種類だけを返す(例外の文言には settings.json のパスや中身の断片が
  // 入りうるため renderer へ送らない。L-017)。renderer は種類ごとに固定の文言を出す
  ipcMain.handle('settings:hasApiKey', async (): Promise<ApiKeyStatus> => {
    try {
      const key = await getApiKey()
      return { ok: true, hasKey: key.trim().length > 0 }
    } catch (err) {
      return { ok: false, reason: toApiKeyLoadFailureReason(err) }
    }
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

  // プロンプト一覧の編集モード / 表示モード。検証は store が行う
  ipcMain.handle('settings:getPromptListMode', async () => getPromptListMode())

  ipcMain.handle(
    'settings:setPromptListMode',
    async (_event: IpcMainInvokeEvent, mode: unknown): Promise<void> => setPromptListMode(mode)
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
