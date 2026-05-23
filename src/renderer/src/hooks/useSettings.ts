import { useState, useEffect, useCallback } from 'react'
import * as claudeApi from '../lib/claudeApi'

interface SettingsState {
  hasKey: boolean
  apiKeyLoaded: boolean
  saveApiKey: (key: string) => Promise<void>
}

export function useSettings(): SettingsState {
  const [hasKey, setHasKey] = useState(false)
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)

  useEffect(() => {
    claudeApi
      .getApiKey()
      .then((has) => setHasKey(has))
      .catch(() => {})
      .finally(() => setApiKeyLoaded(true))
  }, [])

  const saveApiKey = useCallback(async (key: string): Promise<void> => {
    await claudeApi.setApiKey(key)
    setHasKey(true)
  }, [])

  return { hasKey, apiKeyLoaded, saveApiKey }
}
