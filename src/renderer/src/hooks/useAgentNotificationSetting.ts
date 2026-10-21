import { DEFAULT_AGENT_NOTIFICATIONS_ENABLED } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { useBooleanSetting } from './useBooleanSetting'
import type { BooleanSettingState } from './useBooleanSetting'

// エージェントの通知のオン・オフ(通知の設計書「設定」)。読み込み・保存・失敗の戻しは useBooleanSetting

/** 通知の設定の保存の失敗の文言の接頭辞。後ろに固定の理由を付ける */
export const AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX = '通知の設定を保存できませんでした: '

/** enabled は読み込みが終わるまでは null(通知もバッジも出さない) */
export type AgentNotificationSettingState = BooleanSettingState

export function useAgentNotificationSetting(): AgentNotificationSettingState {
  return useBooleanSetting({
    load: settingsApi.getAgentNotificationsEnabled,
    save: settingsApi.setAgentNotificationsEnabled,
    defaultValue: DEFAULT_AGENT_NOTIFICATIONS_ENABLED,
    saveErrorPrefix: AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX,
    logLabel: '[useAgentNotificationSetting]'
  })
}
