import { useApiKeyForm } from '../../hooks/useApiKeyForm'

interface Props {
  hasKey: boolean
  apiKeyLoaded: boolean
  keyStoreError: string | null
  onSave: (key: string) => Promise<void>
}

export default function SettingsPanel({ hasKey, apiKeyLoaded, keyStoreError, onSave }: Props) {
  const { inputValue, setInputValue, isSaving, saved, saveError, isSaveDisabled, handleSave } =
    useApiKeyForm({ apiKeyLoaded, keyStoreError, onSave })

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
