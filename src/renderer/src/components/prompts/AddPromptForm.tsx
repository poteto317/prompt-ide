'use client'
import { usePromptForm } from '../../hooks/usePromptForm'

interface Props {
  onAdd: (title: string, content: string) => void
}

export default function AddPromptForm({ onAdd }: Props) {
  const { title, content, isDisabled, handleTitleChange, handleContentChange, handleSubmit } =
    usePromptForm(onAdd)

  return (
    <form className="add-prompt-form" onSubmit={handleSubmit}>
      <input
        className="add-prompt-form__input"
        type="text"
        placeholder="タイトル"
        aria-label="タイトル"
        value={title}
        onChange={handleTitleChange}
      />
      <textarea
        className="add-prompt-form__input"
        placeholder="プロンプト内容"
        aria-label="プロンプト内容"
        value={content}
        onChange={handleContentChange}
        rows={3}
      />
      <button
        type="submit"
        className="add-prompt-form__button"
        disabled={isDisabled}
      >
        追加
      </button>
    </form>
  )
}
