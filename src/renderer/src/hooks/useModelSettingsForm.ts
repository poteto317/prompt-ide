import { useState, useRef, useEffect, useCallback } from 'react'
import type { ModelSettings } from '@shared/types'

interface UseModelSettingsFormOptions {
  onSave: (settings: ModelSettings) => Promise<void>
}

interface UseModelSettingsFormResult {
  isSaving: boolean
  saved: boolean
  saveError: string | null
  handleSave: (settings: ModelSettings) => Promise<void>
}

export function useModelSettingsForm({
  onSave
}: UseModelSettingsFormOptions): UseModelSettingsFormResult {
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  const handleSave = useCallback(
    async (settings: ModelSettings) => {
      if (isSaving) return
      setIsSaving(true)
      setSaved(false)
      setSaveError(null)
      try {
        await onSave(settings)
        setSaved(true)
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setSaved(false), 2000)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : '保存に失敗しました')
      } finally {
        setIsSaving(false)
      }
    },
    [isSaving, onSave]
  )

  return { isSaving, saved, saveError, handleSave }
}
