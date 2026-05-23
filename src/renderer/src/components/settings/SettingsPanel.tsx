import { useState, useEffect, useRef, useCallback } from 'react'

interface Props {
  apiKey: string
  apiKeyLoaded: boolean
  onSave: (key: string) => Promise<void>
}

export default function SettingsPanel({ apiKey, apiKeyLoaded, onSave }: Props) {
  const [inputValue, setInputValue] = useState(apiKey)
  const [isSaving, setIsSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (apiKeyLoaded) setInputValue(apiKey)
  }, [apiKey, apiKeyLoaded])

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [])

  const handleSave = useCallback(async () => {
    setIsSaving(true)
    try {
      await onSave(inputValue)
      setSaved(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setSaved(false), 2000)
    } finally {
      setIsSaving(false)
    }
  }, [inputValue, onSave])

  return (
    <div className="settings-panel">
      <div className="settings-panel__section">
        <p className="settings-panel__label">Anthropic API キー</p>
        <input
          type="password"
          className="settings-panel__input"
          placeholder="sk-ant-..."
          value={apiKeyLoaded ? inputValue : ''}
          disabled={!apiKeyLoaded || isSaving}
          onChange={(e) => setInputValue(e.target.value)}
          aria-label="API キー"
        />
        <div className="settings-panel__actions">
          <button
            type="button"
            className="settings-panel__save-btn"
            disabled={!apiKeyLoaded || isSaving}
            onClick={handleSave}
          >
            保存
          </button>
          {saved && <span className="settings-panel__saved">保存しました</span>}
        </div>
      </div>
    </div>
  )
}
