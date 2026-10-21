import { DEFAULT_AGENT_SEND_CONFIRM_ENABLED } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { useBooleanSetting } from './useBooleanSetting'
import type { BooleanSettingState } from './useBooleanSetting'

// エージェントへの送信前の確認のオン・オフ(設計書「設定」)。読み込み・保存・失敗の戻しは useBooleanSetting

/** 送信前の確認の設定の保存の失敗の文言の接頭辞。後ろに固定の理由を付ける */
export const AGENT_SEND_CONFIRM_SETTING_SAVE_ERROR_PREFIX =
  '送信前の確認の設定を保存できませんでした: '

/** enabled は読み込みが終わるまでは null(呼び出し側は既定〈DEFAULT_AGENT_SEND_CONFIRM_ENABLED〉とみなす) */
export type AgentSendConfirmSettingState = BooleanSettingState

export function useAgentSendConfirmSetting(): AgentSendConfirmSettingState {
  return useBooleanSetting({
    load: settingsApi.getAgentSendConfirmEnabled,
    save: settingsApi.setAgentSendConfirmEnabled,
    defaultValue: DEFAULT_AGENT_SEND_CONFIRM_ENABLED,
    saveErrorPrefix: AGENT_SEND_CONFIRM_SETTING_SAVE_ERROR_PREFIX,
    logLabel: '[useAgentSendConfirmSetting]'
  })
}
