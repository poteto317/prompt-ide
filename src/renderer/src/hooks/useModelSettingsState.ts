import { useState, useEffect, useCallback } from 'react'
import type { ModelSettings } from '@shared/types'
import { DEFAULT_MODEL_SETTINGS } from '@shared/types'
import * as settingsApi from '../lib/settingsApi'

// 永続化済みのモデル設定値のロード・保存を担う「データ層」のフック。
// 保存中/保存済み/エラーというフォームの一時的なUI状態は useModelSettingsForm が別途担当する。
interface ModelSettingsState {
  modelSettings: ModelSettings
  modelSettingsLoaded: boolean
  saveModelSettings: (settings: ModelSettings) => Promise<void>
}

export function useModelSettingsState(): ModelSettingsState {
  const [modelSettings, setModelSettings] = useState<ModelSettings>(DEFAULT_MODEL_SETTINGS)
  const [modelSettingsLoaded, setModelSettingsLoaded] = useState(false)

  useEffect(() => {
    settingsApi
      .getModelSettings()
      .then((settings) => setModelSettings(settings))
      .catch((err) => {
        console.error('[useModelSettingsState] getModelSettings failed:', err)
      })
      .finally(() => setModelSettingsLoaded(true))
  }, [])

  const saveModelSettings = useCallback(async (settings: ModelSettings): Promise<void> => {
    await settingsApi.setModelSettings(settings)
    setModelSettings(settings)
  }, [])

  return { modelSettings, modelSettingsLoaded, saveModelSettings }
}
