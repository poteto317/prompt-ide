import { useState, useEffect, useCallback } from 'react'
import * as claudeApi from '../lib/claudeApi'

interface SettingsState {
  apiKey: string
  apiKeyLoaded: boolean
  saveApiKey: (key: string) => Promise<void>
}

export function useSettings(): SettingsState {
  const [apiKey, setApiKey] = useState('')
  const [apiKeyLoaded, setApiKeyLoaded] = useState(false)

  useEffect(() => {
    claudeApi.getApiKey().then((key) => {
      setApiKey(key)
      setApiKeyLoaded(true)
    })
  }, [])

  const saveApiKey = useCallback(async (key: string): Promise<void> => {
    await claudeApi.setApiKey(key)
    setApiKey(key)
  }, [])

  return { apiKey, apiKeyLoaded, saveApiKey }
}
