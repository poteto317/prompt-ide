import { useState, useEffect, useCallback } from 'react'
import * as claudeApi from '../lib/claudeApi'
import { API_KEY_LOAD_ERROR_MESSAGES } from '../lib/settingsMessages'

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
      .then((status) => {
        if (status.ok) {
          setHasKey(status.hasKey)
          setKeyStoreError(null)
          return
        }
        // main は読み込みの失敗を理由の種類だけで返す(例外の文言は送らない。L-017)。種類ごとに固定の文言にする
        console.error('[useApiKeySettings] API key load failed:', status.reason)
        setKeyStoreError(API_KEY_LOAD_ERROR_MESSAGES[status.reason])
      })
      .catch((err) => {
        // IPC そのものの失敗。例外の文言は出さない(main の例外の文言を含みうる。L-017)。記録だけして、固定の文言にする
        console.error('[useApiKeySettings] hasApiKey failed:', err)
        setKeyStoreError(API_KEY_LOAD_ERROR_MESSAGES.unknown)
      })
      .finally(() => setApiKeyLoaded(true))
  }, [])

  const saveApiKey = useCallback(async (key: string): Promise<void> => {
    await claudeApi.setApiKey(key)
    setHasKey(true)
  }, [])

  return { hasKey, apiKeyLoaded, keyStoreError, saveApiKey }
}
