import { DEFAULT_AGENT_NOTIFICATIONS_ENABLED } from '@shared/types'
import { readSettingsFile, writeSettingsFile } from './settingsFileStore'

// エージェントの通知のオン・オフの読み書き(userData/settings.json の agentNotificationsEnabled。ほかの設定と同じファイルにマージで書く)

/** 保存された設定。無い・真偽値でなければ既定(オン) */
export async function getAgentNotificationsEnabled(): Promise<boolean> {
  const data = await readSettingsFile()
  return typeof data.agentNotificationsEnabled === 'boolean'
    ? data.agentNotificationsEnabled
    : DEFAULT_AGENT_NOTIFICATIONS_ENABLED
}

/** 検証してから保存する。真偽値でなければ投げる */
export async function setAgentNotificationsEnabled(enabled: unknown): Promise<void> {
  if (typeof enabled !== 'boolean') {
    throw new Error(`通知の設定が不正です: ${String(enabled)}`)
  }
  await writeSettingsFile({ agentNotificationsEnabled: enabled })
}
