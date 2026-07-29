interface Props {
  fileName: string
  isDirty: boolean
  onClose?: () => void
}

export default function EditorTab({ fileName, isDirty, onClose }: Props) {
  return (
    <div className="editor-tab editor-tab--active">
      {fileName}
      {isDirty && (
        <span className="editor-tab__dirty-dot" role="img" aria-label="未保存の変更があります">
          ●
        </span>
      )}
      {onClose && (
        <button
          type="button"
          className="editor-tab__close-btn"
          onClick={onClose}
          aria-label="タブを閉じる"
        >
          ×
        </button>
      )}
    </div>
  )
}
