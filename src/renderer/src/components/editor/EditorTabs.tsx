import EditorTab from './EditorTab'
import EditorSaveControl from './EditorSaveControl'

interface Props {
  fileName: string
  isDirty: boolean
  isSaving: boolean
  saveError: Error | null
  onSave: () => void
  onClose?: () => void
}

export default function EditorTabs({
  fileName,
  isDirty,
  isSaving,
  saveError,
  onSave,
  onClose
}: Props) {
  return (
    <div className="editor-tabs">
      <EditorTab fileName={fileName} isDirty={isDirty} onClose={onClose} />
      <EditorSaveControl
        isDirty={isDirty}
        isSaving={isSaving}
        saveError={saveError}
        onSave={onSave}
      />
    </div>
  )
}
