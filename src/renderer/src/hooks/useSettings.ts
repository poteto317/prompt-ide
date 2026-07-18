import type { ModelSettings } from '@shared/types'
import { useApiKeySettings } from './useApiKeySettings'
import { useModelSettingsState } from './useModelSettingsState'

interface SettingsState {
  hasKey: boolean
  apiKeyLoaded: boolean
  keyStoreError: string | null
  saveApiKey: (key: string) => Promise<void>
  modelSettings: ModelSettings
  modelSettingsLoaded: boolean
  saveModelSettings: (settings: ModelSettings) => Promise<void>
}

export function useSettings(): SettingsState {
  const apiKeySettings = useApiKeySettings()
  const modelSettingsState = useModelSettingsState()

  return { ...apiKeySettings, ...modelSettingsState }
}
