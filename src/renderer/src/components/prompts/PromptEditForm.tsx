'use client'
import type { Prompt } from '../../types'
import { usePromptEditForm } from '../../hooks/usePromptEditForm'
import TagInput from './TagInput'

interface Props {
  prompt: Prompt
  onSubmit: (title: string, content: string, tags: string[]) => void
  onCancel: () => void
}

export default function PromptEditForm({ prompt, onSubmit, onCancel }: Props) {
  const {
    title,
    content,
    tags,
    tagInput,
    isSaveDisabled,
    handleTitleChange,
    handleContentChange,
    handleTagInputChange,
    handleTagInputKeyDown,
    handleRemoveTag,
    handleSave,
  } = usePromptEditForm(prompt, onSubmit)

  return (
    <>
      <input
        className="prompt-item__edit-title"
        type="text"
        value={title}
        onChange={handleTitleChange}
        aria-label="タイトルを編集"
      />
      <textarea
        className="prompt-item__edit-content"
        value={content}
        onChange={handleContentChange}
        aria-label="内容を編集"
        rows={4}
      />
      <TagInput
        tags={tags}
        tagInput={tagInput}
        onTagInputChange={handleTagInputChange}
        onTagInputKeyDown={handleTagInputKeyDown}
        onRemoveTag={handleRemoveTag}
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
          onClick={onCancel}
        >
          キャンセル
        </button>
      </div>
    </>
  )
}
