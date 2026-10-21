import { useState, useRef, useEffect, useCallback, type Dispatch, type SetStateAction } from 'react'
import { API_KEY_SAVE_ERROR_MESSAGE } from '../lib/settingsMessages'

interface UseApiKeyFormOptions {
  apiKeyLoaded: boolean
  keyStoreError: string | null
  onSave: (key: string) => Promise<void>
}

interface UseApiKeyFormResult {
  inputValue: string
  setInputValue: Dispatch<SetStateAction<string>>
  isSaving: boolean
  saved: boolean
  saveError: string | null
  isSaveDisabled: boolean
  handleSave: () => Promise<void>
}

export function useApiKeyForm({
  apiKeyLoaded,
  keyStoreError,
  onSave
}: UseApiKeyFormOptions): UseApiKeyFormResult {
  const [inputValue, setInputValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  const trimmedInput = inputValue.trim()

  const handleSave = useCallback(async () => {
    if (!apiKeyLoaded || isSaving || trimmedInput.length === 0 || keyStoreError !== null) return
    setIsSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await onSave(trimmedInput)
      setInputValue('')
      setSaved(true)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      // 例外の文言は出さない(settings.json のパスや中身の断片を含みうる。L-017)。記録だけして、固定の文言にする
      console.error('[useApiKeyForm] save failed:', err)
      setSaveError(API_KEY_SAVE_ERROR_MESSAGE)
    } finally {
      setIsSaving(false)
    }
  }, [trimmedInput, onSave, apiKeyLoaded, isSaving, keyStoreError])

  const isSaveDisabled =
    !apiKeyLoaded || isSaving || trimmedInput.length === 0 || keyStoreError !== null

  return { inputValue, setInputValue, isSaving, saved, saveError, isSaveDisabled, handleSave }
}
