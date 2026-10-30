interface Props {
  isDirty: boolean
  isSaving: boolean
  saveError: Error | null
  onSave: () => void
}

export default function EditorSaveControl({
  isDirty,
  isSaving,
  saveError,
  onSave
}: Props): React.JSX.Element {
  return (
    <>
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
    </>
  )
}
