import { useState, useRef, useEffect, useCallback } from 'react'
import type { ModelSettings } from '@shared/types'
import { MODEL_SETTINGS_SAVE_ERROR_MESSAGE } from '../lib/settingsMessages'

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
  // React state(isSaving)だけに頼ると、同一レンダー内で handleSave が連続で
  // 呼ばれた場合に setState のバッチングにより両方とも古い値を見てガードを
  // すり抜けてしまう(useFileEditing.ts の savingPathsRef と同じ理由)。
  // 即座に反映される ref で多重実行を防ぐ。
  const isSavingRef = useRef(false)

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current)
    }
  }, [])

  const handleSave = useCallback(
    async (settings: ModelSettings) => {
      if (isSavingRef.current) return
      isSavingRef.current = true
      setIsSaving(true)
      setSaved(false)
      setSaveError(null)
      try {
        await onSave(settings)
        setSaved(true)
        if (timerRef.current !== null) clearTimeout(timerRef.current)
        timerRef.current = setTimeout(() => setSaved(false), 2000)
      } catch (err) {
        // 例外の文言は出さない(settings.json のパスや中身の断片を含みうる。L-017)。記録だけして、固定の文言にする
        console.error('[useModelSettingsForm] save failed:', err)
        setSaveError(MODEL_SETTINGS_SAVE_ERROR_MESSAGE)
      } finally {
        isSavingRef.current = false
        setIsSaving(false)
      }
    },
    [onSave]
  )

  return { isSaving, saved, saveError, handleSave }
}
