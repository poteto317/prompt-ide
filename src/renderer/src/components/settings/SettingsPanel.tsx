import { useState, useEffect, useRef, useCallback } from 'react'

interface Props {
  hasKey: boolean
  apiKeyLoaded: boolean
  keyStoreError: string | null
  onSave: (key: string) => Promise<void>
}

export default function SettingsPanel({ hasKey, apiKeyLoaded, keyStoreError, onSave }: Props) {
  const [inputValue, setInputValue] = useState('')
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleSave = useCallback(async () => {
    const trimmed = inputValue.trim()
    setIsSaving(true)
    setSaved(false)
    setSaveError(null)
    try {
      await onSave(trimmed)
      setInputValue('')
      setSaved(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存に失敗しました')
    } finally {
      setIsSaving(false)
    }
  }, [inputValue, onSave])

  const isSaveDisabled = !apiKeyLoaded || isSaving || inputValue.trim().length === 0 || keyStoreError !== null

  return (
    <div className="settings-panel">
      <div className="settings-panel__section">
        <p className="settings-panel__label">Anthropic API キー</p>
        {keyStoreError && (
          <p className="settings-panel__keystore-error">{keyStoreError}</p>
        )}
        {!keyStoreError && apiKeyLoaded && hasKey && (
          <p className="settings-panel__status">（設定済み）更新するには再入力してください</p>
        )}
        <input
          type="password"
          className="settings-panel__input"
          placeholder={hasKey ? '新しいキーを入力...' : 'sk-ant-...'}
          value={inputValue}
          disabled={!apiKeyLoaded || isSaving || keyStoreError !== null}
          onChange={(e) => setInputValue(e.target.value)}
          aria-label="API キー"
        />
        <div className="settings-panel__actions">
          <button
            type="button"
            className="settings-panel__save-btn"
            disabled={isSaveDisabled}
            onClick={handleSave}
          >
            保存
          </button>
          {saved && <span className="settings-panel__saved">保存しました</span>}
          {saveError && <span className="settings-panel__error">{saveError}</span>}
        </div>
      </div>
    </div>
  )
}
