interface Props {
  fileName: string
  isDirty: boolean
  isSaving: boolean
  error: Error | null
  onSave: () => void
}

export default function EditorTabs({ fileName, isDirty, isSaving, error, onSave }: Props) {
  return (
    <div className="editor-tabs">
      <div className="editor-tab editor-tab--active">
        {fileName}
        {isDirty && (
          <span className="editor-tab__dirty-dot" aria-hidden="true">
            ●
          </span>
        )}
      </div>
      {error && <p className="editor-tabs__error">{error.message}</p>}
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
