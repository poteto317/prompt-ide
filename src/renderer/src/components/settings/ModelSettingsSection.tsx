import { useState } from 'react'
import type { ModelSettings } from '@shared/types'
import { AVAILABLE_MODELS } from '@shared/types'

interface Props {
  initialSettings: ModelSettings
  isSaving: boolean
  saved: boolean
  saveError: string | null
  onSave: (settings: ModelSettings) => void
}

// initialSettings は読み込み完了直後の値を初期値として使うだけなので、
// props 変更を反映する useEffect は不要(親側で key を切り替えて対応する)。
// 保存中/保存済み/エラーの状態(useModelSettingsForm)は親(SettingsPanel)が保持する。
// この コンポーネント内に持つと、保存成功で initialSettings が変わり key ごと
// remount された瞬間に「保存しました」表示が state ごと破棄されてしまうため。
export default function ModelSettingsSection({
  initialSettings,
  isSaving,
  saved,
  saveError,
  onSave
}: Props): React.JSX.Element {
  const [modelId, setModelId] = useState(initialSettings.modelId)
  const [maxTokens, setMaxTokens] = useState(initialSettings.maxTokens)

  // ストリーミング実行のため HTTP タイムアウトの懸念がなく、モデル本来の上限まで許可する
  const selectedModel = AVAILABLE_MODELS.find((m) => m.id === modelId) ?? AVAILABLE_MODELS[0]
  const maxTokensCap = selectedModel.maxOutputTokens

  return (
    <>
      <select
        className="settings-panel__input"
        value={modelId}
        disabled={isSaving}
        onChange={(e) => {
          const next = AVAILABLE_MODELS.find((m) => m.id === e.target.value)
          if (!next) return
          setModelId(next.id)
          setMaxTokens((prev) => Math.min(prev, next.maxOutputTokens))
        }}
        aria-label="モデル"
      >
        {AVAILABLE_MODELS.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </select>
      <label className="settings-panel__label" htmlFor="settings-panel-max-tokens">
        max_tokens(1〜{maxTokensCap}）
      </label>
      <input
        id="settings-panel-max-tokens"
        type="number"
        className="settings-panel__input"
        min={1}
        max={maxTokensCap}
        value={maxTokens}
        disabled={isSaving}
        onChange={(e) => setMaxTokens(Number(e.target.value))}
        aria-label="max_tokens"
      />
      <div className="settings-panel__actions">
        <button
          type="button"
          className="settings-panel__save-btn"
          disabled={
            isSaving || !Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > maxTokensCap
          }
          onClick={() => onSave({ modelId, maxTokens })}
        >
          保存
        </button>
        {saved && <span className="settings-panel__saved">保存しました</span>}
        {saveError && <span className="settings-panel__error">{saveError}</span>}
      </div>
    </>
  )
}
