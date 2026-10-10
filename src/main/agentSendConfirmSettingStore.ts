import { DEFAULT_AGENT_SEND_CONFIRM_ENABLED } from '@shared/types'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// エージェントへの送信前の確認のオン・オフの読み書き(userData/settings.json の agentSendConfirmEnabled。ほかの設定と同じファイルに
// マージで書く。agentNotificationSettingStore と同じ形)

/** 保存された設定。無い・真偽値でなければ既定(オン) */
export async function getAgentSendConfirmEnabled(): Promise<boolean> {
  const data = await readSettingsFile()
  return typeof data.agentSendConfirmEnabled === 'boolean'
    ? data.agentSendConfirmEnabled
    : DEFAULT_AGENT_SEND_CONFIRM_ENABLED
}

/** 検証してから保存する。真偽値でなければ投げる */
export async function setAgentSendConfirmEnabled(enabled: unknown): Promise<void> {
  if (typeof enabled !== 'boolean') {
    throw new Error(`送信前の確認の設定が不正です: ${String(enabled)}`)
  }
  await writeSettingsFile({ agentSendConfirmEnabled: enabled })
}
