import type { ModelSettings } from '@shared/types'
import type { AgentNotificationPanelState, ExecutionModePanelState } from '../../types'
import { useApiKeyForm } from '../../hooks/useApiKeyForm'
import { useModelSettingsForm } from '../../hooks/useModelSettingsForm'
import ModelSettingsSection from './ModelSettingsSection'
import ExecutionModeSection from './ExecutionModeSection'
import AgentNotificationSection from './AgentNotificationSection'

interface Props {
  hasKey: boolean
  apiKeyLoaded: boolean
  keyStoreError: string | null
  onSave: (key: string) => Promise<void>
  modelSettings: ModelSettings
  modelSettingsLoaded: boolean
  onSaveModelSettings: (settings: ModelSettings) => Promise<void>
  /** プロンプトの実行方式(省略時は出さない) */
  executionMode?: ExecutionModePanelState
  /** エージェントの通知の設定(省略時は出さない) */
  agentNotification?: AgentNotificationPanelState
}

export default function SettingsPanel({
  hasKey,
  apiKeyLoaded,
  keyStoreError,
  onSave,
  modelSettings,
  modelSettingsLoaded,
  onSaveModelSettings,
  executionMode,
  agentNotification
}: Props): React.JSX.Element {
  const { inputValue, setInputValue, isSaving, saved, saveError, isSaveDisabled, handleSave } =
    useApiKeyForm({ apiKeyLoaded, keyStoreError, onSave })

  // モデル設定の保存状態はここ(親)で保持する。ModelSettingsSection は保存成功で
  // modelSettings が更新されると key ごと remount されるため、子に持たせると
  // 「保存しました」表示が setSaved(true) の直前に破棄され一度も表示されない。
  const modelForm = useModelSettingsForm({ onSave: onSaveModelSettings })

  return (
    <div className="settings-panel">
      {executionMode !== undefined && (
        <ExecutionModeSection
          mode={executionMode.mode}
          saveError={executionMode.saveError}
          isLocked={executionMode.isLocked}
          lockedReason={executionMode.lockedReason}
          onSelect={executionMode.onSelect}
        />
      )}
      {agentNotification !== undefined && (
        <AgentNotificationSection
          enabled={agentNotification.enabled}
          saveError={agentNotification.saveError}
          onChange={agentNotification.onChange}
        />
      )}
      <div className="settings-panel__section">
        <p className="settings-panel__label">Anthropic API キー</p>
        <p className="settings-panel__note">従来の方式で使います</p>
        {keyStoreError && <p className="settings-panel__keystore-error">{keyStoreError}</p>}
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
      <div className="settings-panel__section">
        <p className="settings-panel__label">モデル</p>
        <p className="settings-panel__note">従来の方式で使います</p>
        {modelSettingsLoaded ? (
          <ModelSettingsSection
            key={`${modelSettings.modelId}:${modelSettings.maxTokens}`}
            initialSettings={modelSettings}
            isSaving={modelForm.isSaving}
            saved={modelForm.saved}
            saveError={modelForm.saveError}
            onSave={modelForm.handleSave}
          />
        ) : (
          <p className="settings-panel__status">読み込み中...</p>
        )}
      </div>
    </div>
  )
}
