'use client'
import { useState } from 'react'

interface Props {
  onAdd: (title: string, content: string) => void
}

export default function AddPromptForm({ onAdd }: Props) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')

  const isDisabled = title.trim() === '' || content.trim() === ''

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>): void => {
    e.preventDefault()
    if (isDisabled) return
    onAdd(title.trim(), content.trim())
    setTitle('')
    setContent('')
  }

  return (
    <form className="add-prompt-form" onSubmit={handleSubmit}>
      <input
        className="add-prompt-form__input"
        type="text"
        placeholder="タイトル"
        aria-label="タイトル"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
      />
      <textarea
        className="add-prompt-form__input"
        placeholder="プロンプト内容"
        aria-label="プロンプト内容"
        value={content}
        onChange={(e) => setContent(e.target.value)}
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
