import { useState, useRef, useEffect, useCallback } from 'react'

interface UseApiKeyFormOptions {
  apiKeyLoaded: boolean
  keyStoreError: string | null
  onSave: (key: string) => Promise<void>
}

interface UseApiKeyFormResult {
  inputValue: string
  setInputValue: (v: string) => void
  isSaving: boolean
  saved: boolean
  saveError: string | null
  isSaveDisabled: boolean
  handleSave: () => Promise<void>
}

export function useApiKeyForm({
  apiKeyLoaded,
  keyStoreError,
  onSave,
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

  const handleSave = useCallback(async () => {
    const trimmed = inputValue.trim()
    if (!apiKeyLoaded || isSaving || trimmed.length === 0 || keyStoreError !== null) return
    setIsSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await onSave(trimmed)
      setInputValue('')
      setSaved(true)
      if (timerRef.current !== null) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [inputValue, onSave, apiKeyLoaded, isSaving, keyStoreError])

  const isSaveDisabled =
    !apiKeyLoaded || isSaving || inputValue.trim().length === 0 || keyStoreError !== null

  return { inputValue, setInputValue, isSaving, saved, saveError, isSaveDisabled, handleSave }
}
