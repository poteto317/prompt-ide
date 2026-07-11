interface Props {
  fileName: string
  isDirty: boolean
  isSaving: boolean
  saveError: Error | null
  onSave: () => void
}

export default function EditorTabs({ fileName, isDirty, isSaving, saveError, onSave }: Props) {
  return (
    <div className="editor-tabs">
      <div className="editor-tab editor-tab--active">
        {fileName}
        {isDirty && (
          <span className="editor-tab__dirty-dot" role="img" aria-label="未保存の変更があります">
            ●
          </span>
        )}
      </div>
      {saveError && (
        <p className="editor-tabs__error" role="alert">
          {saveError.message}
        </p>
      )}
      <button
        type="button"
        className="editor-tabs__save-btn"
        onClick={onSave}
        disabled={!isDirty || isSaving}
        aria-label="保存"
      >
        保存
      </button>
    </div>
  )
}
