import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

interface Props {
  path: string
  fileName: string
  isDirty: boolean
  isActive: boolean
  onActivate: () => void
  onClose: () => void
  /** 閉じるボタンを表示するか。既定は true。WelcomeView のプレースホルダタブは
   * 閉じる操作を持たないため false を渡し、押しても何も起きないボタンを見せない */
  closable?: boolean
}

export default function EditorTab({
  path,
  fileName,
  isDirty,
  isActive,
  onActivate,
  onClose,
  closable = true
}: Props): React.JSX.Element {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: path
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Enter' || e.key === ' ') {
      if (e.key === ' ') {
        e.preventDefault()
      }
      onActivate()
    }
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
      onKeyDown={handleKeyDown}
    >
      {fileName}
      {isDirty && (
        <span className="editor-tab__dirty-dot" role="img" aria-label="未保存の変更があります">
          ●
        </span>
      )}
      {closable && (
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
      )}
    </div>
  )
}
