import { useState, useEffect, useCallback } from 'react'
import * as claudeApi from '../lib/claudeApi'
import { API_KEY_LOAD_ERROR_MESSAGE } from '../lib/settingsMessages'

interface ApiKeySettingsState {
  hasKey: boolean
  apiKeyLoaded: boolean
  keyStoreError: string | null
  saveApiKey: (key: string) => Promise<void>
}

export function useApiKeySettings(): ApiKeySettingsState {
  const [hasKey, setHasKey] = useState(false)
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)
  const [keyStoreError, setKeyStoreError] = useState<string | null>(null)

  useEffect(() => {
    claudeApi
      .hasApiKey()
      .then((has) => {
        setHasKey(has)
        setKeyStoreError(null)
      })
      .catch((err) => {
        // 例外の文言は出さない(settings.json のパスや中身の断片を含みうる。L-017)。記録だけして、固定の文言にする
        console.error('[useApiKeySettings] hasApiKey failed:', err)
        setKeyStoreError(API_KEY_LOAD_ERROR_MESSAGE)
      })
      .finally(() => setApiKeyLoaded(true))
  }, [])

  const saveApiKey = useCallback(async (key: string): Promise<void> => {
    await claudeApi.setApiKey(key)
    setHasKey(true)
  }, [])

  return { hasKey, apiKeyLoaded, keyStoreError, saveApiKey }
}
