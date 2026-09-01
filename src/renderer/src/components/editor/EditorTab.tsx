import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  path: string
  fileName: string
  isDirty: boolean
  isActive: boolean
  onActivate: () => void
  onClose: () => void
}

export default function EditorTab({ path, fileName, isDirty, isActive, onActivate, onClose }: Props) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: path
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="tab"
      aria-selected={isActive}
      tabIndex={0}
      className={`editor-tab${isActive ? ' editor-tab--active' : ''}`}
      onClick={onActivate}
    >
      {fileName}
      {isDirty && (
        <span className="editor-tab__dirty-dot" role="img" aria-label="未保存の変更があります">
          ●
        </span>
      )}
      <button
        type="button"
        className="editor-tab__close-btn"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        aria-label="タブを閉じる"
      >
        ×
      </button>
    </div>
  )
}
