'use client'
import { useState } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import type { Prompt } from '../../types'
import { truncatePreview } from '../../lib/promptUtils'

interface Props {
  prompt: Prompt
  onDelete: (id: string) => void
  onRun: (content: string) => void
  onEdit: (id: string, title: string, content: string) => void
  isRunDisabled?: boolean
  isSortable?: boolean
}

export default function PromptItem({
  prompt,
  onDelete,
  onRun,
  onEdit,
  isRunDisabled = false,
  isSortable = false
}: Props) {
  const [isEditing, setIsEditing] = useState(false)
  const [editTitle, setEditTitle] = useState('')
  const [editContent, setEditContent] = useState('')

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: prompt.id,
    disabled: !isSortable
  })

  const dragStyle = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1
  }

  const handleEditStart = () => {
    setEditTitle(prompt.title)
    setEditContent(prompt.content)
    setIsEditing(true)
  }

  const isSaveDisabled = editTitle.trim() === '' || editContent.trim() === ''

  const handleSave = () => {
    if (isSaveDisabled) return
    onEdit(prompt.id, editTitle.trim(), editContent.trim())
    setIsEditing(false)
  }

  const handleCancel = () => {
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <div ref={setNodeRef} style={dragStyle} className="prompt-item prompt-item--editing">
        <input
          className="prompt-item__edit-title"
          type="text"
          value={editTitle}
          onChange={(e) => setEditTitle(e.target.value)}
          aria-label="タイトルを編集"
        />
        <textarea
          className="prompt-item__edit-content"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          aria-label="内容を編集"
          rows={4}
        />
        <div className="prompt-item__edit-actions">
          <button
            type="button"
            className="prompt-item__save"
            aria-label="変更を保存"
            disabled={isSaveDisabled}
            onClick={handleSave}
          >
            保存
          </button>
          <button
            type="button"
            className="prompt-item__cancel"
            aria-label="編集をキャンセル"
            onClick={handleCancel}
          >
            キャンセル
          </button>
        </div>
      </div>
    )
  }

  return (
    <div ref={setNodeRef} style={dragStyle} className="prompt-item">
      {isSortable && (
        <button
          {...attributes}
          {...listeners}
          type="button"
          style={{ touchAction: 'none' }}
          className="prompt-item__drag-handle"
          aria-label="並び替え"
          onTouchStartCapture={(e) => e.stopPropagation()}
          onMouseDownCapture={(e) => e.stopPropagation()}
        >
          ⠿
        </button>
      )}
      <div className="prompt-item__title">{prompt.title}</div>
      <div className="prompt-item__preview">{truncatePreview(prompt.content)}</div>
      <div className="prompt-item__actions">
        <button
          type="button"
          className="prompt-item__run"
          aria-label="プロンプトを実行"
          disabled={isRunDisabled}
          onClick={() => onRun(prompt.content)}
        >
          実行
        </button>
        <button
          type="button"
          className="prompt-item__edit-btn"
          aria-label="プロンプトを編集"
          onClick={handleEditStart}
        >
          編集
        </button>
        <button
          type="button"
          className="prompt-item__delete"
          aria-label="プロンプトを削除"
          onClick={() => onDelete(prompt.id)}
        >
          削除
        </button>
      </div>
    </div>
  )
}
