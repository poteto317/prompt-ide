'use client'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import type { Prompt } from '../../types'
import { truncatePreview } from '../../lib/promptUtils'

interface Props {
  prompt: Prompt
  isSortable: boolean
  dragHandleProps: {
    attributes: DraggableAttributes
    listeners: DraggableSyntheticListeners
  }
  isRunDisabled: boolean
  onRun: () => void
  onEditStart: () => void
  onDelete: () => void
  onTogglePin: () => void
}

export default function PromptItemView({
  prompt,
  isSortable,
  dragHandleProps,
  isRunDisabled,
  onRun,
  onEditStart,
  onDelete,
  onTogglePin
}: Props) {
  return (
    <>
      {isSortable && (
        <button
          {...dragHandleProps.attributes}
          {...dragHandleProps.listeners}
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
      <button
        type="button"
        className={`prompt-item__pin${prompt.pinned ? ' prompt-item__pin--active' : ''}`}
        aria-label={prompt.pinned ? 'ピン留めを解除' : 'ピン留め'}
        aria-pressed={!!prompt.pinned}
        onClick={onTogglePin}
      >
        {prompt.pinned ? '★' : '☆'}
      </button>
      <div className="prompt-item__title">{prompt.title}</div>
      <div className="prompt-item__preview">{truncatePreview(prompt.content)}</div>
      {prompt.tags && prompt.tags.length > 0 && (
        <div className="prompt-item__tags">
          {prompt.tags.map((tag) => (
            <span key={tag} className="prompt-item__tag">
              {tag}
            </span>
          ))}
        </div>
      )}
      <div className="prompt-item__actions">
        <button
          type="button"
          className="prompt-item__run"
          aria-label="プロンプトを実行"
          disabled={isRunDisabled}
          onClick={onRun}
        >
          実行
        </button>
        <button
          type="button"
          className="prompt-item__edit-btn"
          aria-label="プロンプトを編集"
          onClick={onEditStart}
        >
          編集
        </button>
        <button
          type="button"
          className="prompt-item__delete"
          aria-label="プロンプトを削除"
          onClick={onDelete}
        >
          削除
        </button>
      </div>
    </>
  )
}
