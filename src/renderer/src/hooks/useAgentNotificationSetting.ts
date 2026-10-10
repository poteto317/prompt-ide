import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_AGENT_NOTIFICATIONS_ENABLED } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'
import { toError } from '../lib/errorUtils'

// エージェントの通知のオン・オフ(設計書「設定」)。useExecutionMode と同じ形で、変更は楽観的に反映して保存し、失敗したら戻す

/** 通知の設定の保存の失敗の文言の接頭辞。後ろに理由を付ける */
export const AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX = '通知の設定を保存できませんでした: '

export interface AgentNotificationSettingState {
  /** 読み込みが終わるまでは null(通知もバッジも出さない) */
  enabled: boolean | null
  /** 保存の失敗の文言。次の保存で消える */
  saveError: string | null
  /** すぐ保存する。失敗したら保存前の値に戻し、false を返す */
  changeEnabled: (next: boolean) => Promise<boolean>
}

export function useAgentNotificationSetting(): AgentNotificationSettingState {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)
  const enabledRef = useRef<boolean | null>(null)

  useEffect(() => {
    let cancelled = false
    // 設定ファイルの JSON が壊れていると main は例外を投げる。画面が起動できなくならないよう、既定(オン)で続ける
    settingsApi
      .getAgentNotificationsEnabled()
      .then((loaded) => {
        if (cancelled) return
        enabledRef.current = loaded
        setEnabled(loaded)
      })
      .catch((err) => {
        console.error('[useAgentNotificationSetting] getAgentNotificationsEnabled failed:', err)
        if (cancelled) return
        enabledRef.current = DEFAULT_AGENT_NOTIFICATIONS_ENABLED
        setEnabled(DEFAULT_AGENT_NOTIFICATIONS_ENABLED)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const changeEnabled = useCallback(async (next: boolean): Promise<boolean> => {
    const previous = enabledRef.current
    enabledRef.current = next
    setEnabled(next)
    setSaveError(null)
    try {
      await settingsApi.setAgentNotificationsEnabled(next)
      return true
    } catch (err) {
      enabledRef.current = previous
      setEnabled(previous)
      setSaveError(`${AGENT_NOTIFICATION_SETTING_SAVE_ERROR_PREFIX}${toError(err).message}`)
      return false
    }
  }, [])

  return { enabled, saveError, changeEnabled }
}
