import { useState, useEffect, useCallback } from 'react'
import * as claudeApi from '../lib/claudeApi'

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
        const message = err instanceof Error ? err.message : 'キーストアへのアクセスに失敗しました'
        console.error('[useApiKeySettings] hasApiKey failed:', err)
        setKeyStoreError(message)
      })
      .finally(() => setApiKeyLoaded(true))
  }, [])

  const saveApiKey = useCallback(async (key: string): Promise<void> => {
    await claudeApi.setApiKey(key)
    setHasKey(true)
  }, [])

  return { hasKey, apiKeyLoaded, keyStoreError, saveApiKey }
}
